/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { type ChatStreamEvent, Message, MessageId, ThreadId } from "@bloom/domain";
import { DateTime, Schema } from "effect";
import { applyEvent, isTerminal } from "./chat";
import type { ChatMessage } from "./types";

const messageId = Schema.decodeSync(MessageId);
const threadId = Schema.decodeSync(ThreadId)("019a0000-0000-7000-8000-00000000aaaa");
const now = DateTime.makeUnsafe("2026-10-04T09:00:00Z");

const assistantId = messageId("019a0000-0000-7000-8000-000000000002");

const user: ChatMessage = {
  id: "local-1",
  role: "user",
  parts: [{ type: "text", text: "Please add a task to water the plants tomorrow" }],
  createdAt: now,
};

/** Folds a whole event sequence, like the page does one event at a time. */
const fold = (
  events: ReadonlyArray<ChatStreamEvent>,
  initial: ReadonlyArray<ChatMessage> = [user],
) => events.reduce((messages, event) => applyEvent(messages, event, now), initial);

const persisted = Schema.decodeSync(Message.json)({
  id: assistantId,
  threadId,
  role: "assistant",
  parts: [
    { type: "tool_call", id: "call-1", name: "create_task", args: { title: "Water the plants" } },
    {
      type: "tool_result",
      toolCallId: "call-1",
      name: "create_task",
      ok: true,
      result: { id: "t1" },
    },
    { type: "text", text: "Done. I added it for tomorrow." },
  ],
  runId: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  createdAt: "2026-10-04T09:00:02Z",
});

describe("applyEvent", () => {
  it("builds the assistant reply incrementally in the ADR 0013 order", () => {
    const afterStart = fold([{ type: "message_start", messageId: assistantId, threadId }]);
    expect(afterStart).toHaveLength(2);
    expect(afterStart[1]).toMatchObject({ id: assistantId, role: "assistant", parts: [] });

    const afterTools = fold(
      [
        {
          type: "tool_call",
          messageId: assistantId,
          toolCallId: "call-1",
          name: "create_task",
          args: { title: "Water the plants" },
        },
        {
          type: "tool_result",
          messageId: assistantId,
          toolCallId: "call-1",
          name: "create_task",
          ok: true,
        },
        { type: "tasks_changed" },
      ],
      afterStart,
    );
    expect(afterTools[1]?.parts.map((part) => part.type)).toEqual(["tool_call", "tool_result"]);

    const afterText = fold(
      [
        { type: "text_delta", messageId: assistantId, delta: "Done. " },
        { type: "text_delta", messageId: assistantId, delta: "I added it" },
        { type: "text_delta", messageId: assistantId, delta: " for tomorrow." },
      ],
      afterTools,
    );
    expect(afterText[1]?.parts.at(-1)).toEqual({
      type: "text",
      text: "Done. I added it for tomorrow.",
    });
    // Deltas accumulate into one text part; they never create one part per token.
    expect(afterText[1]?.parts).toHaveLength(3);

    const final = fold([{ type: "message_end", message: persisted }], afterText);
    expect(final).toHaveLength(2);
    expect(final[1]).toBe(persisted);
    expect(final[0]).toBe(user);
  });

  it("starts a new text part when text follows a tool round", () => {
    const messages = fold([
      { type: "message_start", messageId: assistantId, threadId },
      { type: "text_delta", messageId: assistantId, delta: "Let me check." },
      { type: "tool_call", messageId: assistantId, toolCallId: "c", name: "list_tasks", args: {} },
      {
        type: "tool_result",
        messageId: assistantId,
        toolCallId: "c",
        name: "list_tasks",
        ok: true,
      },
      { type: "text_delta", messageId: assistantId, delta: "Three things." },
    ]);
    expect(messages[1]?.parts.map((part) => part.type)).toEqual([
      "text",
      "tool_call",
      "tool_result",
      "text",
    ]);
  });

  it("ignores events for unknown messages and duplicate starts", () => {
    const other = messageId("019a0000-0000-7000-8000-000000000009");
    const start: ChatStreamEvent = { type: "message_start", messageId: assistantId, threadId };
    const messages = fold([start, start, { type: "text_delta", messageId: other, delta: "lost" }]);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.parts).toEqual([]);
  });

  it("appends the final message when message_end arrives without a start", () => {
    const messages = fold([{ type: "message_end", message: persisted }]);
    expect(messages).toEqual([user, persisted]);
  });

  it("drops an empty assistant bubble on error but keeps partial output", () => {
    const empty = fold([
      { type: "message_start", messageId: assistantId, threadId },
      { type: "error", message: "Something went wrong on my side." },
    ]);
    expect(empty).toEqual([user]);

    const partial = fold([
      { type: "message_start", messageId: assistantId, threadId },
      { type: "text_delta", messageId: assistantId, delta: "I started to" },
      { type: "error", message: "Something went wrong on my side." },
    ]);
    expect(partial).toHaveLength(2);
    expect(partial[1]?.parts).toEqual([{ type: "text", text: "I started to" }]);
  });

  it("does not mutate the previous list", () => {
    const before = fold([{ type: "message_start", messageId: assistantId, threadId }]);
    const snapshot = structuredClone(before);
    fold([{ type: "text_delta", messageId: assistantId, delta: "x" }], before);
    expect(before).toEqual(snapshot);
  });
});

describe("isTerminal", () => {
  it("is true only for message_end and error", () => {
    expect(isTerminal({ type: "message_end", message: persisted })).toBe(true);
    expect(isTerminal({ type: "error", message: "x" })).toBe(true);
    expect(isTerminal({ type: "tasks_changed" })).toBe(false);
    expect(isTerminal({ type: "text_delta", messageId: assistantId, delta: "x" })).toBe(false);
  });
});
