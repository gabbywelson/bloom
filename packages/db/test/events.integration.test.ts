import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Event, EventSink } from "@bloom/domain";
import { DateTime, Effect } from "effect";
import { SqlClient } from "effect/sql";
import { ensureTestDatabase, makeTestRuntime, truncateAll } from "./helpers.ts";

const runtime = makeTestRuntime();

beforeAll(async () => {
  await Effect.runPromise(ensureTestDatabase);
  await runtime.runPromise(Effect.void);
});
afterAll(() => runtime.dispose());
beforeEach(() => runtime.runPromise(truncateAll));

describe("EventSinkDb", () => {
  it("inserts new events and reports duplicates by dedupeKey", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const sink = yield* EventSink;
        const occurredAt = DateTime.makeUnsafe("2026-10-04T08:00:00Z");
        const first = yield* sink.ingest({
          source: "gmail",
          type: "message.received",
          occurredAt,
          payload: { id: "m1", thread_id: "t1", labels: ["INBOX"] },
          dedupeKey: "gmail:m1",
        });
        expect(first._tag).toBe("Inserted");
        if (first._tag === "Inserted") {
          expect(first.event).toBeInstanceOf(Event);
          expect(first.event.dedupeKey).toBe("gmail:m1");
          expect(first.event.payload).toEqual({ id: "m1", thread_id: "t1", labels: ["INBOX"] });
          expect(DateTime.formatIso(first.event.occurredAt)).toBe("2026-10-04T08:00:00.000Z");
          expect(DateTime.isUtc(first.event.createdAt)).toBe(true);
        }

        const dup = yield* sink.ingest({
          source: "gmail",
          type: "message.received",
          occurredAt,
          payload: { id: "m1" },
          dedupeKey: "gmail:m1",
        });
        expect(dup).toEqual({ _tag: "Duplicate", dedupeKey: "gmail:m1" });

        // Concurrent ingests of the same key: exactly one wins.
        const results = yield* Effect.all(
          Array.from({ length: 5 }, () =>
            sink.ingest({
              source: "cal",
              type: "moved",
              occurredAt,
              payload: null,
              dedupeKey: "cal:1",
            }),
          ),
          { concurrency: 5 },
        );
        expect(results.filter((r) => r._tag === "Inserted")).toHaveLength(1);
        expect(results.filter((r) => r._tag === "Duplicate")).toHaveLength(4);

        const noKey = yield* sink.ingest({
          source: "system",
          type: "tick",
          occurredAt,
          payload: null,
        });
        const noKeyAgain = yield* sink.ingest({
          source: "system",
          type: "tick",
          occurredAt,
          payload: [1, "two", null],
        });
        expect(noKey._tag).toBe("Inserted");
        expect(noKeyAgain._tag).toBe("Inserted");
        if (noKeyAgain._tag === "Inserted") {
          expect(noKeyAgain.event.payload).toEqual([1, "two", null]);
        }

        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{ n: number }>`SELECT count(*)::int AS n FROM events`;
        expect(rows[0]?.n).toBe(4);
      }),
    ));
});
