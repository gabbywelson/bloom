import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Thread, ThreadId, ThreadService } from "@bloom/domain";
import { DateTime, Effect, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { ensureTestDatabase, makeTestRuntime, truncateAll } from "./helpers.ts";

const runtime = makeTestRuntime();
const threadId = Schema.decodeSync(ThreadId);

beforeAll(async () => {
  await Effect.runPromise(ensureTestDatabase);
  await runtime.runPromise(Effect.void);
});
afterAll(() => runtime.dispose());
beforeEach(() => runtime.runPromise(truncateAll));

describe("ThreadServiceDb", () => {
  it("ensureMain is idempotent under concurrency", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const threads = yield* ThreadService;
        const results = yield* Effect.all(
          Array.from({ length: 5 }, () => threads.ensureMain),
          { concurrency: 5 },
        );
        const winner = results[0];
        if (winner === undefined) {
          throw new Error("expected five results");
        }
        expect(new Set(results.map((t) => t.id)).size).toBe(1);
        expect(winner.kind).toBe("main");
        expect(winner.contextScope).toBe("full");

        const again = yield* threads.ensureMain;
        expect(again.id).toBe(winner.id);

        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM threads WHERE kind = 'main'`;
        expect(rows[0]?.n).toBe(1);
        expect((yield* threads.list).filter((t) => t.kind === "main")).toHaveLength(1);
      }),
    ));

  it("applies the kind-based contextScope default and lists in creation order", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const threads = yield* ThreadService;
        const main = yield* threads.ensureMain;
        const side = yield* threads.create(
          yield* Schema.decodeEffect(Thread.jsonCreate)({
            kind: "side",
            parentThreadId: main.id,
            topic: "Trip",
          }),
        );
        expect(side).toBeInstanceOf(Thread);
        expect(side.contextScope).toBe("minimal");
        expect(side.parentThreadId).toBe(main.id);
        expect(side.status).toBe("active");
        expect(side.lastMessageAt).toBeNull();
        expect(DateTime.isUtc(side.createdAt)).toBe(true);

        const quest = yield* threads.create(
          yield* Schema.decodeEffect(Thread.jsonCreate)({ kind: "quest" }),
        );
        expect(quest.contextScope).toBe("full");

        const explicit = yield* threads.create(
          yield* Schema.decodeEffect(Thread.jsonCreate)({ kind: "side", contextScope: "full" }),
        );
        expect(explicit.contextScope).toBe("full");

        expect((yield* threads.list).map((t) => t.id)).toEqual([
          main.id,
          side.id,
          quest.id,
          explicit.id,
        ]);
        expect((yield* threads.get(side.id)).topic).toBe("Trip");
      }),
    ));

  it("touch records lastMessageAt; unknown ids fail with ThreadNotFound", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const threads = yield* ThreadService;
        const main = yield* threads.ensureMain;
        const at = DateTime.makeUnsafe("2026-10-04T12:00:00Z");
        yield* threads.touch(main.id, at);
        const touched = yield* threads.get(main.id);
        expect(
          touched.lastMessageAt === null ? null : DateTime.formatIso(touched.lastMessageAt),
        ).toBe("2026-10-04T12:00:00.000Z");
        expect(DateTime.formatIso(touched.updatedAt)).toBe("2026-10-04T12:00:00.000Z");

        const missing = threadId("missing");
        expect((yield* Effect.flip(threads.get(missing)))._tag).toBe("ThreadNotFound");
        expect((yield* Effect.flip(threads.touch(missing, at)))._tag).toBe("ThreadNotFound");
      }),
    ));
});
