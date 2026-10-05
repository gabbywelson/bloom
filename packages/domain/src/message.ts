import { Schema } from "effect";
import { Model } from "effect/schema";
import { Immutable, Nullable, Patchable } from "./fields.ts";
import { MessageId, RunId, ThreadId } from "./ids.ts";
import { MessagePart } from "./message-part.ts";

/** Who authored a message turn. */
export const MessageRole = Schema.Literals(["user", "assistant", "system", "tool"]);
export type MessageRole = typeof MessageRole.Type;

/** Concatenates the text of all `text` parts, in order, separated by newlines. */
export const messageText = (message: { readonly parts: ReadonlyArray<MessagePart> }): string =>
  message.parts
    .filter(MessagePart.guards.text)
    .map((part) => part.text)
    .join("\n");

/**
 * One turn in a thread. `parts` is stored as jsonb (pg decodes it to parsed JSON,
 * so the same `Schema.Array(MessagePart)` works in every variant). Immutable except `parts`.
 */
export class Message extends Model.Class<Message>("Message")({
  id: Model.UuidV7Insert(MessageId),
  threadId: Immutable(ThreadId),
  role: Immutable(MessageRole),
  parts: Patchable(Schema.Array(MessagePart)),
  runId: Nullable(RunId),
  createdAt: Model.DateTimeInsertFromDate,
}) {
  /** Text content of a message: all `text` parts joined with newlines. */
  static text(message: { readonly parts: ReadonlyArray<MessagePart> }): string {
    return messageText(message);
  }
}

/** Input for `MessageService.append`; `runId` may be omitted. */
export const MessageAppend = Schema.Struct({
  threadId: ThreadId,
  role: MessageRole,
  parts: Schema.Array(MessagePart),
  runId: Schema.optionalKey(Schema.NullOr(RunId)),
});
export type MessageAppend = typeof MessageAppend.Type;
