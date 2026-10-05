import { CaptureNotFound, DeviceNotFound, TaskNotFound, ThreadNotFound } from "@bloom/domain";
import { HttpApiSchema } from "effect/http-api";

/** `TaskNotFound` as an HTTP 404 response; the domain error class is used directly. */
export const TaskNotFound404 = TaskNotFound.pipe(HttpApiSchema.status(404));

/** `ThreadNotFound` as an HTTP 404 response; the domain error class is used directly. */
export const ThreadNotFound404 = ThreadNotFound.pipe(HttpApiSchema.status(404));

/** `CaptureNotFound` as an HTTP 404 response. */
export const CaptureNotFound404 = CaptureNotFound.pipe(HttpApiSchema.status(404));

/** `DeviceNotFound` as an HTTP 404 response. */
export const DeviceNotFound404 = DeviceNotFound.pipe(HttpApiSchema.status(404));
