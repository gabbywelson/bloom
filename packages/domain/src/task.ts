import { Schema } from "effect";
import { Model } from "effect/schema";
import { Nullable, NullableTimestamp, Patchable, ServerTimestamp, WithDefault } from "./fields.ts";
import { TaskId } from "./ids.ts";

/** Lifecycle of a task; `inbox` until triaged. */
export const TaskStatus = Schema.Literals([
  "inbox",
  "next",
  "scheduled",
  "waiting",
  "done",
  "dropped",
]).annotate({ identifier: "TaskStatus" });
export type TaskStatus = typeof TaskStatus.Type;

/** Kind of energy a task needs, so Bloom can match tasks to how Gabby feels. */
export const EnergyKind = Schema.Literals([
  "focus",
  "admin",
  "physical",
  "social",
  "rest",
]).annotate({ identifier: "EnergyKind" });
export type EnergyKind = typeof EnergyKind.Type;

/** Where a task came from. */
export const TaskSource = Schema.Literals(["user", "agent", "import", "integration"]).annotate({
  identifier: "TaskSource",
});
export type TaskSource = typeof TaskSource.Type;

/** Effort in spoons, 1 (trivial) to 5 (a whole day's energy). */
export const Effort = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 }));
export type Effort = typeof Effort.Type;

/**
 * A thing to do once. The central domain object; agents mutate it only through
 * `TaskService`. Variants: `Task`/`insert`/`update` for the DB, `json`/`jsonCreate`/`jsonUpdate` for the API.
 */
export class Task extends Model.Class<Task>("Task")({
  id: Model.UuidV7Insert(TaskId),
  title: Patchable(Schema.NonEmptyString),
  notes: Nullable(Schema.String),
  status: WithDefault(TaskStatus, "inbox"),
  due: NullableTimestamp,
  scheduledFor: NullableTimestamp,
  effort: Nullable(Effort),
  energyKind: Nullable(EnergyKind),
  area: Nullable(Schema.String),
  source: WithDefault(TaskSource, "user"),
  parentId: Nullable(TaskId),
  completedAt: ServerTimestamp,
  createdAt: Model.DateTimeInsertFromDate,
  updatedAt: Model.DateTimeUpdateFromDate,
}) {}

/**
 * Wire schemas with stable names. The `identifier` becomes the OpenAPI
 * component name (`Task`, `TaskUpdate`), which is what generated clients
 * (the Swift app) call these types. Use them wherever the API exposes a task.
 */
export const TaskJson = Task.json.annotate({ identifier: "Task" });
export const TaskUpdateJson = Task.jsonUpdate.annotate({ identifier: "TaskUpdate" });

/** Client payload for creating a task (decoded; defaults applied). */
export type TaskCreate = typeof Task.jsonCreate.Type;
/** Client payload for patching a task; every key optional. */
export type TaskUpdate = typeof Task.jsonUpdate.Type;
