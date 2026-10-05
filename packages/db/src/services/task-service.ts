import {
  type Actor,
  Task,
  type TaskCreate,
  type TaskId,
  type TaskListFilter,
  TaskNotFound,
  TaskService,
  type TaskUpdate,
} from "@bloom/domain";
import { DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { makeEventRepo } from "../repos/events.ts";
import { makeTaskRepo } from "../repos/tasks.ts";
import { makeIngest } from "./event-sink.ts";

type AuditType = "task.created" | "task.updated" | "task.completed" | "task.removed";

const encodePatch = Schema.encodeEffect(Task.jsonUpdate);
const asJson = Schema.decodeUnknownEffect(Schema.Json);

/**
 * Postgres-backed `TaskService`. Every mutation runs in one transaction with an
 * audit `Event` (source "domain") so agent-visible changes are always logged.
 */
export const TaskServiceDb: Layer.Layer<TaskService, never, SqlClient.SqlClient> = Layer.effect(
  TaskService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const repo = yield* makeTaskRepo;
    const ingest = makeIngest(yield* makeEventRepo);

    const lookup = Effect.fnUntraced(function* (id: TaskId) {
      return yield* repo.findById(id).pipe(
        Effect.catchTags({
          NoSuchElementError: () => new TaskNotFound({ id }),
          SchemaError: Effect.die,
          SqlError: Effect.die,
        }),
      );
    });

    /**
     * Mutations read the row under `FOR UPDATE` inside their transaction so two
     * concurrent patches serialize instead of the second overwriting the first.
     */
    const lockRow = Effect.fnUntraced(function* (id: TaskId) {
      return yield* repo.findByIdForUpdate(id).pipe(
        Effect.catchTags({
          NoSuchElementError: () => new TaskNotFound({ id }),
          SchemaError: Effect.die,
          SqlError: Effect.die,
        }),
      );
    });

    const audit = Effect.fnUntraced(function* (
      type: AuditType,
      taskId: TaskId,
      actor: Actor,
      changes?: TaskUpdate,
    ) {
      const encodedChanges =
        changes === undefined ? undefined : yield* encodePatch(changes).pipe(Effect.orDie);
      const payload = yield* asJson(
        encodedChanges === undefined
          ? { taskId, actor }
          : { taskId, actor, changes: encodedChanges },
      ).pipe(Effect.orDie);
      yield* ingest({
        source: "domain",
        type,
        occurredAt: yield* DateTime.now,
        payload,
      });
    });

    const create = Effect.fn("TaskService.create")(function* (input: TaskCreate, actor: Actor) {
      const now = yield* DateTime.now;
      const row = yield* Task.insert
        .makeEffect({ ...input, completedAt: input.status === "done" ? now : null })
        .pipe(Effect.orDie);
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const task = yield* repo.insert(row);
            yield* audit("task.created", task.id, actor);
            return task;
          }),
        )
        .pipe(Effect.orDie);
    });

    const list = Effect.fn("TaskService.list")(function* (filter?: TaskListFilter) {
      return yield* repo
        .list(filter?.status === undefined ? {} : { status: filter.status })
        .pipe(Effect.orDie);
    });

    const get = Effect.fn("TaskService.get")(function* (id: TaskId) {
      return yield* lookup(id);
    });

    /** Shared by update and complete: lock the row, merge the patch, own completedAt, write the audit row. */
    const applyPatch = Effect.fnUntraced(function* (
      id: TaskId,
      patch: TaskUpdate,
      actor: Actor,
      type: AuditType,
    ) {
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const existing = yield* lockRow(id);
            const now = yield* DateTime.now;
            // oxlint-disable-next-line typescript/no-misused-spread -- fields are copied; the update schema re-validates
            const merged = { ...existing, ...patch };
            const completedAt =
              merged.status === "done"
                ? (existing.completedAt ?? now)
                : existing.status === "done"
                  ? null
                  : existing.completedAt;
            const row = yield* Task.update
              .makeEffect({
                id: existing.id,
                title: merged.title,
                notes: merged.notes,
                status: merged.status,
                due: merged.due,
                scheduledFor: merged.scheduledFor,
                effort: merged.effort,
                energyKind: merged.energyKind,
                area: merged.area,
                source: merged.source,
                parentId: merged.parentId,
                completedAt,
              })
              .pipe(Effect.orDie);
            const task = yield* repo.update(row).pipe(Effect.orDie);
            yield* audit(type, task.id, actor, patch);
            return task;
          }),
        )
        .pipe(Effect.catchTag("SqlError", Effect.die));
    });

    const update = Effect.fn("TaskService.update")(function* (
      id: TaskId,
      patch: TaskUpdate,
      actor: Actor,
    ) {
      return yield* applyPatch(id, patch, actor, "task.updated");
    });

    const complete = Effect.fn("TaskService.complete")(function* (id: TaskId, actor: Actor) {
      return yield* applyPatch(id, { status: "done" }, actor, "task.completed");
    });

    const remove = Effect.fn("TaskService.remove")(function* (id: TaskId, actor: Actor) {
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const existing = yield* lockRow(id);
            yield* repo.delete(existing.id).pipe(Effect.orDie);
            yield* audit("task.removed", existing.id, actor);
          }),
        )
        .pipe(Effect.catchTag("SqlError", Effect.die));
    });

    return TaskService.of({ create, list, get, update, complete, remove });
  }),
);
