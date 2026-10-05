import { Task, TaskId, TaskJson, TaskStatus, TaskUpdateJson } from "@bloom/domain";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { Authorization } from "../auth.ts";
import { TaskNotFound404 } from "./errors.ts";

/** Query for `GET /api/tasks`: optional status filter (`?status=inbox&status=next`). */
export const TaskListQuery = {
  status: Schema.optional(Schema.Array(TaskStatus)),
};

/**
 * Payload for `POST /api/tasks`: the encoded side of `Task.jsonCreate`, so
 * every key except `title` is optional for the TypeScript client as well as
 * on the wire. Handlers turn it into a `TaskCreate` with
 * `decodePayload(Task.jsonCreate)`, which applies the defaults.
 */
export const TaskCreateInput = Schema.toEncoded(Task.jsonCreate).annotate({
  identifier: "TaskCreate",
});
export type TaskCreateInput = typeof TaskCreateInput.Type;

/** Task CRUD. All endpoints require `Authorization`; mutations go through `TaskService`. */
export class TasksGroup extends HttpApiGroup.make("tasks")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: TaskListQuery,
      success: Schema.Array(TaskJson),
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List tasks",
        description: "Tasks in creation order, optionally filtered by one or more statuses.",
      }),
    ),
    HttpApiEndpoint.post("create", "/", {
      payload: TaskCreateInput,
      success: TaskJson,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Create a task",
        description:
          "Creates a task. Omitted fields take their defaults (`status: inbox`, nullable fields `null`).",
      }),
    ),
    HttpApiEndpoint.get("get", "/:id", {
      params: { id: TaskId },
      success: TaskJson,
      error: TaskNotFound404,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get a task",
        description: "One task by id.",
      }),
    ),
    HttpApiEndpoint.patch("update", "/:id", {
      params: { id: TaskId },
      payload: TaskUpdateJson,
      success: TaskJson,
      error: TaskNotFound404,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Patch a task",
        description:
          "Partial update: only the keys present are changed. `completedAt` is managed by the server from `status`.",
      }),
    ),
    HttpApiEndpoint.post("complete", "/:id/complete", {
      params: { id: TaskId },
      success: TaskJson,
      error: TaskNotFound404,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Complete a task",
        description: "Sets `status` to `done` and stamps `completedAt`.",
      }),
    ),
    HttpApiEndpoint.delete("remove", "/:id", {
      params: { id: TaskId },
      error: TaskNotFound404,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Delete a task",
        description: "Removes the task. Responds 204 with no body.",
      }),
    ),
  )
  .middleware(Authorization)
  .prefix("/tasks")
  .annotateMerge(
    OpenApi.annotations({
      title: "Tasks",
      description: "Things to do once: the central domain object.",
    }),
  ) {}
