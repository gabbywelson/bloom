import { Context, DateTime, Effect, Layer, Ref } from "effect";
import type { Actor } from "../actor.ts";
import { TaskNotFound } from "../errors.ts";
import type { TaskId } from "../ids.ts";
import { Task, type TaskCreate, type TaskStatus, type TaskUpdate } from "../task.ts";

/** Optional filter for `TaskService.list`. */
export interface TaskListFilter {
  readonly status?: ReadonlyArray<TaskStatus>;
}

/**
 * Operations on tasks. The only way agents and the API may mutate tasks.
 *
 * Ordering contract: `list` returns tasks in creation order. Implementations
 * must order by `(created_at, id)` or a sequence column, never by `id` alone
 * (UUIDv7 ids created in the same millisecond have no defined order).
 * `completedAt` is owned by the service: set when status becomes `done`,
 * cleared when it leaves `done`.
 */
export interface TaskServiceShape {
  readonly create: (input: TaskCreate, actor: Actor) => Effect.Effect<Task>;
  readonly list: (filter?: TaskListFilter) => Effect.Effect<ReadonlyArray<Task>>;
  readonly get: (id: TaskId) => Effect.Effect<Task, TaskNotFound>;
  readonly update: (
    id: TaskId,
    patch: TaskUpdate,
    actor: Actor,
  ) => Effect.Effect<Task, TaskNotFound>;
  readonly complete: (id: TaskId, actor: Actor) => Effect.Effect<Task, TaskNotFound>;
  readonly remove: (id: TaskId, actor: Actor) => Effect.Effect<void, TaskNotFound>;
}

/**
 * Task domain service. `layerMemory` is a Ref-backed implementation for tests
 * and the agent harness; the DB-backed layer lives in `@bloom/db`.
 */
export class TaskService extends Context.Service<TaskService, TaskServiceShape>()(
  "bloom/domain/TaskService",
) {
  static readonly layerMemory = Layer.effect(
    TaskService,
    Effect.gen(function* () {
      // Map iteration order is insertion order, and re-setting an existing key
      // keeps its position, so the store itself is the creation-order index.
      const store = yield* Ref.make(new Map<TaskId, Task>());

      const lookup = Effect.fnUntraced(function* (id: TaskId) {
        const tasks = yield* Ref.get(store);
        const task = tasks.get(id);
        if (task === undefined) {
          return yield* new TaskNotFound({ id });
        }
        return task;
      });

      const put = (task: Task) => Ref.update(store, (tasks) => new Map(tasks).set(task.id, task));

      const create = Effect.fn("TaskService.create")(function* (input: TaskCreate, _actor: Actor) {
        const now = yield* DateTime.now;
        const task = yield* Task.insert
          .makeEffect({ ...input, completedAt: input.status === "done" ? now : null })
          .pipe(Effect.orDie);
        const stored = new Task(task);
        yield* put(stored);
        return stored;
      });

      const list = Effect.fn("TaskService.list")(function* (filter?: TaskListFilter) {
        const tasks = Array.from((yield* Ref.get(store)).values());
        const statuses = filter?.status;
        return statuses === undefined
          ? tasks
          : tasks.filter((task) => statuses.includes(task.status));
      });

      const get = Effect.fn("TaskService.get")(function* (id: TaskId) {
        return yield* lookup(id);
      });

      const update = Effect.fn("TaskService.update")(function* (
        id: TaskId,
        patch: TaskUpdate,
        _actor: Actor,
      ) {
        const existing = yield* lookup(id);
        const now = yield* DateTime.now;
        // oxlint-disable-next-line typescript/no-misused-spread -- fields are copied; the class constructor re-validates
        const merged = { ...existing, ...patch, updatedAt: now };
        const completedAt =
          merged.status === "done"
            ? (existing.completedAt ?? now)
            : existing.status === "done"
              ? null
              : existing.completedAt;
        const next = new Task({ ...merged, completedAt });
        yield* put(next);
        return next;
      });

      const complete = Effect.fn("TaskService.complete")(function* (id: TaskId, actor: Actor) {
        return yield* update(id, { status: "done" }, actor);
      });

      const remove = Effect.fn("TaskService.remove")(function* (id: TaskId, _actor: Actor) {
        yield* lookup(id);
        yield* Ref.update(store, (tasks) => {
          const next = new Map(tasks);
          next.delete(id);
          return next;
        });
      });

      return TaskService.of({ create, list, get, update, complete, remove });
    }),
  );
}
