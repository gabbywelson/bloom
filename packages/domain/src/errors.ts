import { Schema } from "effect";
import { CaptureId, MessageId, TaskId, ThreadId } from "./ids.ts";

/** No task with this id. */
export class TaskNotFound extends Schema.TaggedError<TaskNotFound>()("TaskNotFound", {
  id: TaskId,
}) {}

/** No thread with this id. */
export class ThreadNotFound extends Schema.TaggedError<ThreadNotFound>()("ThreadNotFound", {
  id: ThreadId,
}) {}

/** No message with this id. */
export class MessageNotFound extends Schema.TaggedError<MessageNotFound>()("MessageNotFound", {
  id: MessageId,
}) {}

/** No capture with this id. */
export class CaptureNotFound extends Schema.TaggedError<CaptureNotFound>()("CaptureNotFound", {
  id: CaptureId,
}) {}
