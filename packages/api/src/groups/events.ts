import { EventIngest, EventJson } from "@bloom/domain";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { Authorization } from "../auth.ts";

/** Sources only the server writes: domain audit events and internal timers. */
export const RESERVED_EVENT_SOURCES: ReadonlyArray<string> = ["domain", "system"];

/** The event names a reserved or empty source, or an empty type. Encoded as HTTP 400. */
export class InvalidEventSource extends Schema.TaggedError<InvalidEventSource>()(
  "InvalidEventSource",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

/**
 * Payload for `POST /api/events`: the encoded side of the domain
 * `EventIngest` (ISO `occurredAt`, optional `dedupeKey`). Handlers decode it
 * with `decodePayload(EventIngest)` (ADR 0014).
 */
export const EventIngestInput = Schema.toEncoded(EventIngest).annotate({
  identifier: "EventIngest",
});
export type EventIngestInput = typeof EventIngestInput.Type;

/** A new event was stored. */
export const EventInserted = Schema.Struct({
  _tag: Schema.Literal("Inserted"),
  event: EventJson,
}).annotate({ identifier: "EventInserted" });

/** An event with this `dedupeKey` already exists; nothing was written. */
export const EventDuplicate = Schema.Struct({
  _tag: Schema.Literal("Duplicate"),
  dedupeKey: Schema.String,
}).annotate({ identifier: "EventDuplicate" });

/** What `POST /api/events` did: the wire form of the domain `IngestResult`. */
export const IngestResultJson = Schema.Union([EventInserted, EventDuplicate]).annotate({
  identifier: "IngestResult",
});

/** Client-side ingestion into the event pipeline (HealthKit summaries first). */
export class EventsGroup extends HttpApiGroup.make("events")
  .add(
    HttpApiEndpoint.post("ingest", "/", {
      payload: EventIngestInput,
      success: IngestResultJson,
      error: InvalidEventSource,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Ingest an event",
        description:
          "Appends an event from a client (e.g. `source: healthkit`, `type: daily_summary`). With a `dedupeKey` the call is idempotent: a repeat answers `Duplicate` and writes nothing. The sources `domain` and `system` are reserved for the server.",
      }),
    ),
  )
  .middleware(Authorization)
  .prefix("/events")
  .annotateMerge(
    OpenApi.annotations({
      title: "Events",
      description: "Things that happened that Bloom might care about, sent by clients.",
    }),
  ) {}
