import { Event, type EventIngest, EventSink, type IngestResult } from "@bloom/domain";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { makeEventRepo } from "../repos/events.ts";

/**
 * Inserts an event, or reports a duplicate when `dedupeKey` was seen before.
 * Shared by `EventSinkDb` and by `TaskServiceDb` (audit events in the same
 * transaction), so neither layer depends on the other.
 */
export const makeIngest = (repo: Effect.Success<typeof makeEventRepo>) =>
  Effect.fn("EventSink.ingest")(function* (input: EventIngest) {
    const dedupeKey = input.dedupeKey ?? null;
    const row = yield* Event.insert.makeEffect({
      source: input.source,
      type: input.type,
      occurredAt: input.occurredAt,
      payload: input.payload,
      dedupeKey,
    });
    const inserted = yield* repo.insertIfNew(row);
    const event = inserted[0];
    if (event === undefined) {
      // Only a dedupe_key conflict yields zero rows; without a key the insert cannot be skipped.
      return { _tag: "Duplicate", dedupeKey: dedupeKey ?? "" } satisfies IngestResult;
    }
    return { _tag: "Inserted", event } satisfies IngestResult;
  }, Effect.orDie);

/** Postgres-backed `EventSink`. Duplicate detection is a single INSERT ... ON CONFLICT DO NOTHING. */
export const EventSinkDb: Layer.Layer<EventSink, never, SqlClient.SqlClient> = Layer.effect(
  EventSink,
  Effect.gen(function* () {
    const repo = yield* makeEventRepo;
    return EventSink.of({ ingest: makeIngest(repo) });
  }),
);
