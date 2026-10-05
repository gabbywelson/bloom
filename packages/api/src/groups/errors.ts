import { TaskNotFound, ThreadNotFound } from "@bloom/domain";
import { HttpApiSchema } from "effect/http-api";

/** `TaskNotFound` as an HTTP 404 response; the domain error class is used directly. */
export const TaskNotFound404 = TaskNotFound.pipe(HttpApiSchema.status(404));

/** `ThreadNotFound` as an HTTP 404 response; the domain error class is used directly. */
export const ThreadNotFound404 = ThreadNotFound.pipe(HttpApiSchema.status(404));
