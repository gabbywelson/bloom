import { EnergyKind, Task, TaskService, TaskStatus } from "@bloom/domain";
import { Effect, Schema } from "effect";
import { AiError, Tool, Toolkit } from "effect/ai";

/**
 * Parameters the model fills in for `create_task`. Deliberately flat and
 * forgiving: everything but the title is optional, dates are ISO strings, and
 * the status defaults to `inbox` so Gabby triages, not the model.
 */
export const CreateTaskParams = Schema.Struct({
  title: Schema.NonEmptyString.annotate({
    description: "Plain, short title in Gabby's words, e.g. 'Call the dentist'",
  }),
  notes: Schema.optionalKey(Schema.String).annotate({
    description: "Optional details worth keeping with the task",
  }),
  due: Schema.optionalKey(Schema.String).annotate({
    description:
      "Optional due date-time as an ISO 8601 string. Only when Gabby gave a time; never invent one",
  }),
  effort: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 })),
  ).annotate({
    description: "Optional effort in spoons, 1 (trivial) to 5 (a whole day's energy)",
  }),
  energyKind: Schema.optionalKey(EnergyKind).annotate({
    description: "Optional kind of energy the task needs: focus, admin, physical, social or rest",
  }),
  area: Schema.optionalKey(Schema.String).annotate({
    description: "Optional life area, e.g. Home, Health, Money, Projects, Self",
  }),
});
export type CreateTaskParams = typeof CreateTaskParams.Type;

/** Parameters for `list_tasks`; omit `status` for everything that is still open. */
export const ListTasksParams = Schema.Struct({
  status: Schema.optionalKey(Schema.Array(TaskStatus)).annotate({
    description:
      "Optional statuses to include (inbox, next, scheduled, waiting, done, dropped). Defaults to open tasks",
  }),
});
export type ListTasksParams = typeof ListTasksParams.Type;

/** Statuses `list_tasks` returns when the model does not ask for specific ones. */
export const openStatuses: ReadonlyArray<TaskStatus> = ["inbox", "next", "scheduled", "waiting"];

/** Creates a task on Gabby's behalf (SOUL.md: say so in one line afterwards). */
export const createTask = Tool.make("create_task", {
  description:
    "Create a task when Gabby asks you to remember something to do. Use a plain title in " +
    "their words. Do not invent due dates; if timing matters and they did not say, ask. " +
    "After creating, tell Gabby in one line what you added.",
  parameters: CreateTaskParams,
  success: Task.json,
});

/** Reads tasks so the model can summarize them like a person would. */
export const listTasks = Tool.make("list_tasks", {
  description:
    "List Gabby's tasks when they ask what is on their plate. Summarize the result like a " +
    "person would, not like a database dump. Defaults to open tasks; pass statuses to narrow.",
  parameters: ListTasksParams,
  success: Schema.Array(Task.json),
});

/** The domain tools every conversational run gets. Handlers live in `BloomToolkitLive`. */
export const BloomToolkit = Toolkit.make(createTask, listTasks);
export type BloomTools = Toolkit.Tools<typeof BloomToolkit>;

/** Names of the tools, for the system prompt. */
export const bloomToolNames: ReadonlyArray<string> = Object.keys(BloomToolkit.tools);

const decodeTaskCreate = Schema.decodeUnknownEffect(Task.jsonCreate);

/**
 * Tool handlers. They mutate state only through `TaskService` (the audit log
 * comes for free) and act as the `agent` actor.
 */
export const BloomToolkitLive = BloomToolkit.toLayer(
  Effect.gen(function* () {
    const tasks = yield* TaskService;

    const create_task = Effect.fn("BloomToolkit.create_task")(function* (params: CreateTaskParams) {
      const input = yield* decodeTaskCreate({
        title: params.title,
        notes: params.notes ?? null,
        due: params.due ?? null,
        effort: params.effort ?? null,
        energyKind: params.energyKind ?? null,
        area: params.area ?? null,
        source: "agent",
      }).pipe(
        Effect.mapError(
          (error) =>
            new AiError.ToolParameterValidationError({
              toolName: "create_task",
              description: error.message,
            }),
        ),
      );
      return yield* tasks.create(input, "agent");
    });

    const list_tasks = Effect.fn("BloomToolkit.list_tasks")(function* (params: ListTasksParams) {
      return yield* tasks.list({ status: params.status ?? openStatuses });
    });

    return BloomToolkit.of({ create_task, list_tasks });
  }),
);
