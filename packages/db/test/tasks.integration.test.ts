import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Event, Task, TaskId, TaskService } from "@bloom/domain";
import { DateTime, Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { ensureTestDatabase, makeTestRuntime, truncateAll } from "./helpers.ts";

const runtime = makeTestRuntime();
const taskId = Schema.decodeSync(TaskId);

const minimal = (title: string, overrides: Partial<typeof Task.jsonCreate.Encoded> = {}) =>
  Schema.decodeSync(Task.jsonCreate)({ ...overrides, title });

const domainEvents = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* SqlSchema.findAll({
    Request: Schema.Void,
    Result: Event,
    execute: () => sql`SELECT * FROM events WHERE source = 'domain' ORDER BY created_at, seq`,
  })();
});

beforeAll(async () => {
  await Effect.runPromise(ensureTestDatabase);
  await runtime.runPromise(Effect.void);
});
afterAll(() => runtime.dispose());
beforeEach(() => runtime.runPromise(truncateAll));

describe("TaskServiceDb", () => {
  it("creates, lists, gets, updates, completes and removes, auditing each mutation", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const tasks = yield* TaskService;
        const created = yield* tasks.create(
          minimal("Buy milk", { effort: 1, due: "2026-10-06T09:00:00Z" }),
          "user",
        );
        expect(created).toBeInstanceOf(Task);
        expect(created.status).toBe("inbox");
        expect(created.completedAt).toBeNull();
        expect(DateTime.isUtc(created.createdAt)).toBe(true);
        expect(DateTime.isUtc(created.updatedAt)).toBe(true);
        expect(created.due === null ? null : DateTime.formatIso(created.due)).toBe(
          "2026-10-06T09:00:00.000Z",
        );

        const second = yield* tasks.create(
          minimal("Call dentist", { status: "next", energyKind: "social", source: "agent" }),
          "agent",
        );
        expect((yield* tasks.list()).map((t) => t.id)).toEqual([created.id, second.id]);
        expect((yield* tasks.list({ status: ["next"] })).map((t) => t.id)).toEqual([second.id]);
        expect(yield* tasks.list({ status: [] })).toEqual([]);

        const fetched = yield* tasks.get(created.id);
        expect(fetched.title).toBe("Buy milk");

        const updated = yield* tasks.update(
          created.id,
          { title: "Buy oat milk", effort: 2 },
          "user",
        );
        expect(updated.title).toBe("Buy oat milk");
        expect(updated.effort).toBe(2);
        expect(updated.status).toBe("inbox");
        expect(DateTime.toEpochMillis(updated.updatedAt)).toBeGreaterThanOrEqual(
          DateTime.toEpochMillis(created.updatedAt),
        );
        expect(DateTime.toEpochMillis(updated.createdAt)).toBe(
          DateTime.toEpochMillis(created.createdAt),
        );

        const completed = yield* tasks.complete(created.id, "user");
        expect(completed.status).toBe("done");
        expect(completed.completedAt).not.toBeNull();

        const stillDone = yield* tasks.update(created.id, { notes: "2%" }, "agent");
        expect(
          stillDone.completedAt === null ? null : DateTime.toEpochMillis(stillDone.completedAt),
        ).toBe(
          completed.completedAt === null ? null : DateTime.toEpochMillis(completed.completedAt),
        );

        const reopened = yield* tasks.update(created.id, { status: "next" }, "user");
        expect(reopened.completedAt).toBeNull();

        yield* tasks.remove(second.id, "system");
        expect((yield* tasks.list()).map((t) => t.id)).toEqual([created.id]);

        const events = yield* domainEvents;
        expect(events.map((e) => e.type)).toEqual([
          "task.created",
          "task.created",
          "task.updated",
          "task.completed",
          "task.updated",
          "task.updated",
          "task.removed",
        ]);
        expect(events.every((e) => e.dedupeKey === null)).toBe(true);
        expect(events.every((e) => DateTime.isUtc(e.occurredAt))).toBe(true);
        expect(events[0]?.payload).toEqual({ taskId: created.id, actor: "user" });
        expect(events[2]?.payload).toEqual({
          taskId: created.id,
          actor: "user",
          changes: { title: "Buy oat milk", effort: 2 },
        });
        expect(events[3]?.payload).toEqual({
          taskId: created.id,
          actor: "user",
          changes: { status: "done" },
        });
        expect(events[6]?.payload).toEqual({ taskId: second.id, actor: "system" });
      }),
    ));

  it("sets completedAt on create when status is done", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const tasks = yield* TaskService;
        const done = yield* tasks.create(minimal("Already done", { status: "done" }), "user");
        expect(done.completedAt).not.toBeNull();
      }),
    ));

  it("lists in creation order for a burst of inserts", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const tasks = yield* TaskService;
        const ids: Array<TaskId> = [];
        for (let i = 0; i < 50; i++) {
          ids.push((yield* tasks.create(minimal(`t${i}`), "user")).id);
        }
        expect((yield* tasks.list()).map((t) => t.id)).toEqual(ids);
      }),
    ));

  it("fails with TaskNotFound for unknown ids and writes no audit event", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const tasks = yield* TaskService;
        const missing = taskId("missing");
        expect((yield* Effect.flip(tasks.get(missing)))._tag).toBe("TaskNotFound");
        expect((yield* Effect.flip(tasks.update(missing, { title: "x" }, "user"))).id).toBe(
          missing,
        );
        expect((yield* Effect.flip(tasks.complete(missing, "user")))._tag).toBe("TaskNotFound");
        expect((yield* Effect.flip(tasks.remove(missing, "user")))._tag).toBe("TaskNotFound");
        expect(yield* domainEvents).toEqual([]);
      }),
    ));

  it("keeps both sides of two concurrent disjoint patches (row lock, no lost update)", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const tasks = yield* TaskService;
        const created = yield* tasks.create(minimal("orig", { notes: "orig" }), "user");
        // Slow every UPDATE so both transactions would read before either writes
        // if the row were not locked; makes the lost-update race deterministic.
        yield* sql.unsafe(
          `CREATE OR REPLACE FUNCTION bloom_test_slow_update() RETURNS trigger AS $$
           BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$ LANGUAGE plpgsql`,
        );
        yield* sql.unsafe(
          `CREATE TRIGGER bloom_test_slow_update BEFORE UPDATE ON tasks
           FOR EACH ROW EXECUTE FUNCTION bloom_test_slow_update()`,
        );
        const cleanup = Effect.all([
          sql.unsafe(`DROP TRIGGER IF EXISTS bloom_test_slow_update ON tasks`),
          sql.unsafe(`DROP FUNCTION IF EXISTS bloom_test_slow_update()`),
        ]).pipe(Effect.orDie);

        yield* Effect.all(
          [
            tasks.update(created.id, { title: "from A" }, "user"),
            tasks.update(created.id, { notes: "from B" }, "agent"),
          ],
          { concurrency: 2 },
        ).pipe(Effect.ensuring(cleanup));

        const final = yield* tasks.get(created.id);
        expect(final.title).toBe("from A");
        expect(final.notes).toBe("from B");

        const events = yield* domainEvents;
        expect(events.map((e) => e.type)).toEqual(["task.created", "task.updated", "task.updated"]);
      }),
    ));

  it("rolls back the task when the audit event cannot be written", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const tasks = yield* TaskService;
        // Force the audit insert to fail: an events CHECK that no domain event can satisfy.
        yield* sql`ALTER TABLE events ADD CONSTRAINT no_domain CHECK (source <> 'domain')`;
        const exit = yield* Effect.exit(tasks.create(minimal("Doomed"), "user"));
        yield* sql`ALTER TABLE events DROP CONSTRAINT no_domain`;
        expect(exit._tag).toBe("Failure");
        expect(yield* tasks.list()).toEqual([]);
      }),
    ));
});
