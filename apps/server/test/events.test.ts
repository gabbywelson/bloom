import { describe, expect, it } from "bun:test";
import { Authorization, BloomApi, CurrentUser } from "@bloom/api";
import { EventSink, UserId } from "@bloom/domain";
import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { EventsLive } from "../src/http/groups/events.ts";

const AuthorizationAllow = Layer.succeed(Authorization)((httpEffect) =>
  Effect.provideService(httpEffect, CurrentUser, {
    id: Schema.decodeSync(UserId)("user-gabby"),
    email: "gabby@example.com",
    name: "Gabby",
  }),
);

const makeClient = HttpApiTest.groups(BloomApi, ["events"]);

const run = <A, E>(body: (client: Effect.Success<typeof makeClient>) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.flatMap(makeClient, body).pipe(
      Effect.provide(
        Layer.mergeAll(
          EventsLive.pipe(
            Layer.provideMerge(AuthorizationAllow),
            Layer.provide(EventSink.layerMemory),
          ),
          HttpServer.layerServices,
        ),
      ),
      Effect.scoped,
    ),
  );

const summary = {
  source: "healthkit",
  type: "daily_summary",
  occurredAt: "2026-10-04T07:00:00.000Z",
  payload: { day: "2026-10-04", steps: 8123, sleepMinutes: 431, restingHeartRate: 58 },
  dedupeKey: "healthkit:2026-10-04",
};

describe("POST /api/events", () => {
  it("stores a HealthKit daily summary once and reports the repeat as Duplicate", async () => {
    const [first, second] = await run((client) =>
      Effect.all([
        client.events.ingest({ payload: summary }),
        client.events.ingest({ payload: { ...summary, payload: { day: "2026-10-04" } } }),
      ]),
    );
    expect(first._tag).toBe("Inserted");
    if (first._tag === "Inserted") {
      expect(first.event.type).toBe("daily_summary");
      expect(first.event.payload).toEqual(summary.payload);
    }
    expect(second).toEqual({ _tag: "Duplicate", dedupeKey: "healthkit:2026-10-04" });
  });

  it("accepts events without a dedupeKey", async () => {
    const result = await run((client) =>
      client.events.ingest({
        payload: {
          source: "ios",
          type: "app_opened",
          occurredAt: summary.occurredAt,
          payload: null,
        },
      }),
    );
    expect(result._tag).toBe("Inserted");
  });

  it("refuses reserved and empty sources with a 400", async () => {
    for (const source of ["domain", "system", " "]) {
      const error = await run((client) =>
        Effect.flip(client.events.ingest({ payload: { ...summary, source } })),
      );
      expect(error._tag).toBe("InvalidEventSource");
    }
  });
});
