import { Schema } from "effect";
import { MessageId, ThreadId } from "./ids.ts";
import { Message } from "./message.ts";
import { UiComponent } from "./ui-component.ts";

/** A new assistant message has started. */
export const MessageStartEvent = Schema.Struct({
  type: Schema.Literal("message_start"),
  messageId: MessageId,
  threadId: ThreadId,
});

/** Incremental text appended to the current message. */
export const TextDeltaEvent = Schema.Struct({
  type: Schema.Literal("text_delta"),
  messageId: MessageId,
  delta: Schema.String,
});

/** The model requested a tool call. */
export const ToolCallEvent = Schema.Struct({
  type: Schema.Literal("tool_call"),
  messageId: MessageId,
  toolCallId: Schema.String,
  name: Schema.String,
  args: Schema.Json,
});

/** A tool call finished; full result lives in the message parts. */
export const ToolResultEvent = Schema.Struct({
  type: Schema.Literal("tool_result"),
  messageId: MessageId,
  toolCallId: Schema.String,
  name: Schema.String,
  ok: Schema.Boolean,
});

/** A UI component was emitted into the current message. */
export const UiComponentEvent = Schema.Struct({
  type: Schema.Literal("ui_component"),
  messageId: MessageId,
  component: UiComponent,
});

/** Tasks changed during the run; clients should refetch. */
export const TasksChangedEvent = Schema.Struct({ type: Schema.Literal("tasks_changed") });

/** The message is complete; carries the final persisted message. */
export const MessageEndEvent = Schema.Struct({
  type: Schema.Literal("message_end"),
  message: Message.json,
});

/** The run failed; `message` is safe to show the user. */
export const StreamErrorEvent = Schema.Struct({
  type: Schema.Literal("error"),
  message: Schema.String,
});

/**
 * Server-to-web SSE event for a chat run. Discriminated on `type`;
 * use `ChatStreamEvent.match` / `.guards`.
 */
export const ChatStreamEvent = Schema.Union([
  MessageStartEvent,
  TextDeltaEvent,
  ToolCallEvent,
  ToolResultEvent,
  UiComponentEvent,
  TasksChangedEvent,
  MessageEndEvent,
  StreamErrorEvent,
]).pipe(Schema.toTaggedUnion("type"));
export type ChatStreamEvent = typeof ChatStreamEvent.Type;
