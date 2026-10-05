/**
 * Pure reducer for the chat SSE stream (ADR 0013):
 *
 *   message_start → [tool_call, tool_result, ui_component, tasks_changed]* → text_delta* → message_end
 *   ... or → error (terminal; the stream may then fail, which the caller ignores)
 *
 * Each event maps to a new message list, so the page can assign the result to
 * its `$state` and Svelte re-renders only what changed. Side effects
 * (`tasks_changed` refetch, surfacing `error` text) are the caller's job.
 */
import type { ChatStreamEvent, MessagePart } from "@bloom/domain";
import type { DateTime } from "effect";
import { type ChatMessage, toChatMessage } from "./types";

type Messages = ReadonlyArray<ChatMessage>;

/** `message_end` and `error` both end a run; nothing follows them. */
export const isTerminal = (event: ChatStreamEvent): boolean =>
  event.type === "message_end" || event.type === "error";

const replaceAt = (messages: Messages, index: number, message: ChatMessage): Messages => {
  const next = messages.slice();
  next[index] = message;
  return next;
};

const updateMessage = (
  messages: Messages,
  id: string,
  update: (message: ChatMessage) => ChatMessage,
): Messages => {
  const index = messages.findIndex((message) => message.id === id);
  const current = messages[index];
  return current === undefined ? messages : replaceAt(messages, index, update(current));
};

const appendPart = (messages: Messages, id: string, part: MessagePart): Messages =>
  updateMessage(messages, id, (message) => ({ ...message, parts: [...message.parts, part] }));

/** Appends `delta` to the trailing text part, or starts a new one after a tool/ui part. */
const appendText = (message: ChatMessage, delta: string): ChatMessage => {
  const last = message.parts.at(-1);
  if (last?.type === "text") {
    return {
      ...message,
      parts: [...message.parts.slice(0, -1), { type: "text", text: last.text + delta }],
    };
  }
  return { ...message, parts: [...message.parts, { type: "text", text: delta }] };
};

/**
 * Applies one stream event to the message list. `now` stamps the assistant
 * message created on `message_start`; it is replaced by the persisted message
 * on `message_end`.
 */
export const applyEvent = (
  messages: Messages,
  event: ChatStreamEvent,
  now: DateTime.Utc,
): Messages => {
  switch (event.type) {
    case "message_start":
      return messages.some((message) => message.id === event.messageId)
        ? messages
        : [...messages, { id: event.messageId, role: "assistant", parts: [], createdAt: now }];
    case "text_delta":
      return updateMessage(messages, event.messageId, (message) =>
        appendText(message, event.delta),
      );
    case "tool_call":
      return appendPart(messages, event.messageId, {
        type: "tool_call",
        id: event.toolCallId,
        name: event.name,
        args: event.args,
      });
    case "tool_result":
      // The event carries no payload; the full result arrives with `message_end`.
      return appendPart(messages, event.messageId, {
        type: "tool_result",
        toolCallId: event.toolCallId,
        name: event.name,
        ok: event.ok,
        result: null,
      });
    case "ui_component":
      return appendPart(messages, event.messageId, {
        type: "ui_component",
        component: event.component,
      });
    case "tasks_changed":
      return messages;
    case "message_end": {
      const final = toChatMessage(event.message);
      const index = messages.findIndex((message) => message.id === final.id);
      return index < 0 ? [...messages, final] : replaceAt(messages, index, final);
    }
    case "error":
      // A reply that failed before producing anything leaves no empty bubble behind.
      return messages.filter(
        (message) => !(message.role === "assistant" && message.parts.length === 0),
      );
  }
};
