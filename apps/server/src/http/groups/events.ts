import { BloomApi, decodePayload, InvalidEventSource, RESERVED_EVENT_SOURCES } from "@bloom/api";
import { EventIngest, EventSink } from "@bloom/domain";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

const decodeIngest = decodePayload(EventIngest);

/**
 * `POST /api/events`: client ingestion into the pipeline through `EventSink`,
 * idempotent by `dedupeKey`. Payloads can be private (HealthKit, ADR 0021):
 * nothing here logs them, and no run reads events into a model context.
 */
export const EventsLive = HttpApiBuilder.group(
  BloomApi,
  "events",
  Effect.fn(function* (handlers) {
    const sink = yield* EventSink;
    return handlers.handle(
      "ingest",
      Effect.fn(function* ({ payload }) {
        const input = yield* decodeIngest(payload);
        if (input.source.trim() === "" || input.type.trim() === "") {
          return yield* new InvalidEventSource({ message: "An event needs a source and a type." });
        }
        if (RESERVED_EVENT_SOURCES.includes(input.source)) {
          return yield* new InvalidEventSource({
            message: `The source "${input.source}" is reserved for the server.`,
          });
        }
        yield* Effect.annotateCurrentSpan({
          "bloom.event.source": input.source,
          "bloom.event.type": input.type,
        });
        return yield* sink.ingest(input);
      }),
    );
  }),
);
