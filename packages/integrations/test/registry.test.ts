import { describe, expect, it } from "bun:test";
import { EventSink } from "@bloom/domain";
import { DateTime, Effect, Layer, Schema, Stream } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { type Integration, defineIntegration, integrations } from "../src/index.ts";

describe("integrations registry", () => {
  it("is empty until the first external source lands", () => {
    expect(integrations).toEqual([]);
  });

  it("integration names are unique", () => {
    const names = integrations.map((integration) => integration.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("defineIntegration", () => {
  it("preserves every field, including an ingestion Layer that emits through EventSink", async () => {
    const ingestion = Layer.effectDiscard(
      Effect.gen(function* () {
        const sink = yield* EventSink;
        yield* sink.ingest({
          source: "fake",
          type: "started",
          occurredAt: yield* DateTime.now,
          payload: null,
          dedupeKey: "fake:started",
        });
      }),
    );
    const integration = defineIntegration({
      name: "fake",
      description: "A test double",
      tools: undefined,
      ingestion,
    });
    expect(integration.name).toBe("fake");
    expect(integration.description).toBe("A test double");
    expect(integration.tools).toBeUndefined();
    expect(integration.ingestion).toBe(ingestion);

    // The ingestion Layer only needs EventSink; building it writes the event.
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* EventSink;
        return yield* sink.ingest({
          source: "fake",
          type: "started",
          occurredAt: yield* DateTime.now,
          payload: null,
          dedupeKey: "fake:started",
        });
      }).pipe(Effect.provide(Layer.provideMerge(ingestion, EventSink.layerMemory))),
    );
    expect(result).toEqual({ _tag: "Duplicate", dedupeKey: "fake:started" });
  });

  it("carries runnable tools: the toolkit plus a handlers Layer that may use EventSink", async () => {
    const RecordNote = Tool.make("RecordNote", {
      description: "Writes a note event",
      parameters: Schema.Struct({ text: Schema.String }),
      success: Schema.String,
    });
    const toolkit = Toolkit.make(RecordNote);
    const handlers = toolkit.toLayer(
      Effect.gen(function* () {
        const sink = yield* EventSink;
        return toolkit.of({
          RecordNote: ({ text }) =>
            sink
              .ingest({
                source: "fake",
                type: "note",
                occurredAt: DateTime.makeUnsafe(0),
                payload: { text },
              })
              .pipe(Effect.map((result) => result._tag)),
        });
      }),
    );
    const integration: Integration = defineIntegration({
      name: "fake",
      description: "A test double with one tool",
      tools: { toolkit, handlers },
      ingestion: undefined,
    });
    expect(integration.tools?.toolkit).toBe(toolkit);
    expect(Object.keys(Toolkit.merge(toolkit).tools)).toEqual(["RecordNote"]);

    // What apps/server will do: run the toolkit with the integration's own handlers.
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const ready = yield* toolkit;
        const stream = yield* ready.handle("RecordNote", { text: "hello" });
        return yield* Stream.runCollect(stream);
      }).pipe(Effect.provide(Layer.provideMerge(handlers, EventSink.layerMemory))),
    );
    expect(outcome.map((item) => item.result)).toEqual(["Inserted"]);
  });
});
