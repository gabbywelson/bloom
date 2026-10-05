import { Context, Effect, Layer, Ref } from "effect";
import { Event, type EventIngest } from "../event.ts";

/** Result of ingesting an event: stored, or skipped because `dedupeKey` was seen before. */
export type IngestResult =
  | { readonly _tag: "Inserted"; readonly event: Event }
  | { readonly _tag: "Duplicate"; readonly dedupeKey: string };

/** Entry point of the event pipeline; every source writes events through it. */
export interface EventSinkShape {
  readonly ingest: (input: EventIngest) => Effect.Effect<IngestResult>;
}

/** Event sink with a Ref-backed `layerMemory` that dedupes by `dedupeKey`. */
export class EventSink extends Context.Service<EventSink, EventSinkShape>()(
  "bloom/domain/EventSink",
) {
  static readonly layerMemory = Layer.effect(
    EventSink,
    Effect.gen(function* () {
      const events = yield* Ref.make<ReadonlyArray<Event>>([]);
      const seen = yield* Ref.make(new Set<string>());

      const ingest = Effect.fn("EventSink.ingest")(function* (
        input: EventIngest,
      ): Effect.fn.Return<IngestResult> {
        const dedupeKey = input.dedupeKey ?? null;
        if (dedupeKey !== null) {
          const isNew = yield* Ref.modify(seen, (keys) =>
            keys.has(dedupeKey) ? [false, keys] : [true, new Set(keys).add(dedupeKey)],
          );
          if (!isNew) {
            return { _tag: "Duplicate", dedupeKey };
          }
        }
        const event = new Event(
          yield* Event.insert
            .makeEffect({
              source: input.source,
              type: input.type,
              occurredAt: input.occurredAt,
              payload: input.payload,
              dedupeKey,
            })
            .pipe(Effect.orDie),
        );
        yield* Ref.update(events, (all) => [...all, event]);
        return { _tag: "Inserted", event };
      });

      return EventSink.of({ ingest });
    }),
  );
}
