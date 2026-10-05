import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Capture, CaptureId, CaptureNotFound, CaptureService, Event } from "@bloom/domain";
import { DateTime, Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { ensureTestDatabase, makeTestRuntime, truncateAll } from "./helpers.ts";

const runtime = makeTestRuntime();
const decodeCreate = Schema.decodeSync(Capture.jsonCreate);

const captureEvents = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* SqlSchema.findAll({
    Request: Schema.Void,
    Result: Event,
    execute: () =>
      sql`SELECT * FROM events WHERE source = 'domain' AND type LIKE 'capture.%' ORDER BY created_at, seq`,
  })();
});

beforeAll(async () => {
  await Effect.runPromise(ensureTestDatabase);
  await runtime.runPromise(Effect.void);
});
afterAll(() => runtime.dispose());
beforeEach(() => runtime.runPromise(truncateAll));

describe("CaptureServiceDb", () => {
  it("creates, lists in order, filters by status and triages, auditing each mutation", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const captures = yield* CaptureService;
        const link = yield* captures.create(
          decodeCreate({
            kind: "share",
            payload: { url: "https://example.com/a", title: "An article", nested: { tags: ["x"] } },
          }),
          "user",
        );
        expect(link).toBeInstanceOf(Capture);
        expect(link.status).toBe("new");
        expect(link.payload).toEqual({
          url: "https://example.com/a",
          title: "An article",
          nested: { tags: ["x"] },
        });
        expect(DateTime.isUtc(link.createdAt)).toBe(true);

        const note = yield* captures.create(
          decodeCreate({ kind: "text", payload: { text: "Buy stamps" } }),
          "user",
        );
        // A JSON null payload is stored as jsonb 'null' (ADR 0012), not SQL NULL.
        const empty = yield* captures.create(
          decodeCreate({ kind: "voice", payload: null }),
          "user",
        );
        expect(empty.payload).toBeNull();

        expect((yield* captures.list()).map((capture) => capture.id)).toEqual([
          link.id,
          note.id,
          empty.id,
        ]);

        const routed = yield* captures.update(
          note.id,
          { status: "routed", routedTo: "task:019a" },
          "agent",
        );
        expect(routed.status).toBe("routed");
        expect(routed.routedTo).toBe("task:019a");
        expect(routed.payload).toEqual({ text: "Buy stamps" });
        expect(DateTime.toEpochMillis(routed.updatedAt)).toBeGreaterThanOrEqual(
          DateTime.toEpochMillis(note.updatedAt),
        );

        const transcribed = yield* captures.update(empty.id, { transcript: "Call mum" }, "system");
        expect(transcribed.transcript).toBe("Call mum");
        expect(transcribed.status).toBe("new");

        expect((yield* captures.list({ status: ["new"] })).map((capture) => capture.id)).toEqual([
          link.id,
          empty.id,
        ]);
        expect((yield* captures.get(note.id)).status).toBe("routed");

        const events = yield* captureEvents;
        expect(events.map((event) => event.type)).toEqual([
          "capture.created",
          "capture.created",
          "capture.created",
          "capture.updated",
          "capture.updated",
        ]);
        expect(events[3]?.payload).toEqual({
          captureId: note.id,
          kind: "text",
          actor: "agent",
          changes: { status: "routed", routedTo: "task:019a" },
        });
        // The payload (possibly a photo) never enters the audit log.
        expect(JSON.stringify(events.map((event) => event.payload))).not.toContain("Buy stamps");
      }),
    ));

  it("fails with CaptureNotFound for unknown ids and writes nothing", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const captures = yield* CaptureService;
        const missing = Schema.decodeSync(CaptureId)("019a0000-0000-7000-8000-00000000dead");
        expect(yield* Effect.flip(captures.get(missing))).toBeInstanceOf(CaptureNotFound);
        expect(
          yield* Effect.flip(captures.update(missing, { status: "dismissed" }, "user")),
        ).toBeInstanceOf(CaptureNotFound);
        expect(yield* captureEvents).toEqual([]);
      }),
    ));
});
