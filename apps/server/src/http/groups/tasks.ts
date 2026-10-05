import { BloomApi, decodePayload } from "@bloom/api";
import { Task, TaskService } from "@bloom/domain";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

/** `POST /api/tasks` carries the encoded side of `Task.jsonCreate` (ADR 0014). */
const decodeTaskCreate = decodePayload(Task.jsonCreate);

/** Every mutation goes through `TaskService` as the `user` actor, so the audit `Event` is written. */
export const TasksLive = HttpApiBuilder.group(
  BloomApi,
  "tasks",
  Effect.fn(function* (handlers) {
    const tasks = yield* TaskService;
    return handlers.handleAll({
      list: ({ query }) =>
        tasks.list(query.status === undefined ? undefined : { status: query.status }),
      create: ({ payload }) =>
        Effect.flatMap(decodeTaskCreate(payload), (input) => tasks.create(input, "user")),
      get: ({ params }) => tasks.get(params.id),
      update: ({ params, payload }) => tasks.update(params.id, payload, "user"),
      complete: ({ params }) => tasks.complete(params.id, "user"),
      remove: ({ params }) => tasks.remove(params.id, "user"),
    });
  }),
);
