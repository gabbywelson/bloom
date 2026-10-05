import { describe, expect, it } from "bun:test";
import { DateTime, Effect, Schema } from "effect";
import {
  ChatStreamEvent,
  Message,
  MessagePart,
  messageText,
  TaskId,
  ThreadId,
  UiComponent,
} from "../src/index.ts";

/** Simulates the wire: serialize to a JSON string and parse back as `unknown`. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const isJsonObject = (json: Schema.Json): json is Schema.JsonObject =>
  json !== null && typeof json === "object" && !Array.isArray(json);

/** Narrows an encoded `Schema.Json` value to an object so fields can be inspected. */
const obj = (json: Schema.Json): Schema.JsonObject => {
  if (!isJsonObject(json)) {
    throw new Error("expected a JSON object");
  }
  return json;
};

const taskId = Schema.decodeSync(TaskId);
const threadId = Schema.decodeSync(ThreadId);

const partLabel = MessagePart.match({
  text: (part) => `text:${part.text}`,
  image: (part) => `image:${part.url}`,
  tool_call: (part) => `tool_call:${part.name}`,
  tool_result: (part) => `tool_result:${part.name}:${part.ok}`,
  ui_component: (part) => `ui:${part.component.kind}`,
});

describe("MessagePart", () => {
  it("matches every member exhaustively", () => {
    const parts: ReadonlyArray<MessagePart> = [
      { type: "text", text: "hi" },
      { type: "image", url: "u", alt: "a" },
      { type: "tool_call", id: "1", name: "f", args: [1, 2] },
      { type: "tool_result", toolCallId: "1", name: "f", ok: false, result: null },
      {
        type: "ui_component",
        component: { kind: "option_picker", prompt: "?", options: [{ id: "a", label: "A" }] },
      },
    ];
    expect(parts.map(partLabel)).toEqual([
      "text:hi",
      "image:u",
      "tool_call:f",
      "tool_result:f:false",
      "ui:option_picker",
    ]);
    expect(MessagePart.discriminants).toEqual([
      "text",
      "image",
      "tool_call",
      "tool_result",
      "ui_component",
    ]);
    expect(MessagePart.guards.text(parts[0])).toBe(true);
    expect(MessagePart.guards.text(parts[1])).toBe(false);
    expect(MessagePart.guards.ui_component(parts[4])).toBe(true);
  });

  it("decodes and encodes JSON, rejecting unknown types", () => {
    const codec = Schema.toCodecJson(MessagePart);
    const decoded = Schema.decodeSync(codec)({ type: "image", url: "u" });
    expect(decoded).toEqual({ type: "image", url: "u" });
    expect("alt" in decoded).toBe(false);
    expect(() => Schema.decodeSync(codec)({ type: "video", url: "u" })).toThrow();
    expect(() => Schema.decodeSync(codec)({ type: "text" })).toThrow();
  });

  it("messageText joins text parts only", () => {
    expect(
      messageText({
        parts: [
          { type: "text", text: "a" },
          { type: "image", url: "u" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a\nb");
    expect(messageText({ parts: [] })).toBe("");
  });
});

describe("UiComponent", () => {
  it("round-trips each component through JSON with ISO timestamps", () => {
    const codec = Schema.toCodecJson(UiComponent);
    const due = DateTime.makeUnsafe("2026-10-06T09:00:00Z");
    const components: ReadonlyArray<UiComponent> = [
      { kind: "option_picker", prompt: "Which?", options: [{ id: "a", label: "A" }] },
      {
        kind: "task_card",
        taskId: taskId("t1"),
        title: "Buy milk",
        status: "next",
        due,
      },
      {
        kind: "confirm",
        prompt: "Send?",
        confirmLabel: "Send",
        cancelLabel: "Cancel",
        action: { name: "send_email", args: { to: "x" } },
      },
      {
        kind: "snooze_picker",
        prompt: "When?",
        choices: [{ id: "tonight", label: "Tonight", until: due }],
      },
    ];
    for (const component of components) {
      const encoded = Schema.encodeSync(codec)(component);
      const roundTripped = wire(encoded);
      const decoded = Schema.decodeUnknownSync(codec)(roundTripped);
      expect(Schema.encodeSync(codec)(decoded)).toEqual(encoded);
      expect(UiComponent.guards[component.kind](decoded)).toBe(true);
    }
    const card = obj(Schema.encodeSync(codec)(components[1]!));
    expect(card.due).toBe("2026-10-06T09:00:00.000Z");
    expect(UiComponent.discriminants).toEqual([
      "option_picker",
      "task_card",
      "confirm",
      "snooze_picker",
    ]);
  });
});

describe("ChatStreamEvent", () => {
  it("round-trips every event through JSON", async () => {
    const codec = Schema.toCodecJson(ChatStreamEvent);
    const message = new Message(
      await Effect.runPromise(
        Message.insert.makeEffect({
          threadId: threadId("th1"),
          role: "assistant",
          parts: [{ type: "text", text: "done" }],
        }),
      ),
    );
    const events: ReadonlyArray<ChatStreamEvent> = [
      { type: "message_start", messageId: message.id, threadId: message.threadId },
      { type: "text_delta", messageId: message.id, delta: "do" },
      {
        type: "tool_call",
        messageId: message.id,
        toolCallId: "c1",
        name: "create_task",
        args: { title: "x" },
      },
      {
        type: "tool_result",
        messageId: message.id,
        toolCallId: "c1",
        name: "create_task",
        ok: true,
      },
      {
        type: "ui_component",
        messageId: message.id,
        component: { kind: "option_picker", prompt: "?", options: [] },
      },
      { type: "tasks_changed" },
      { type: "message_end", message },
      { type: "error", message: "model unavailable" },
    ];
    for (const event of events) {
      const encoded = Schema.encodeSync(codec)(event);
      const roundTripped = wire(encoded);
      const decoded = Schema.decodeUnknownSync(codec)(roundTripped);
      expect(decoded.type).toBe(event.type);
      expect(Schema.encodeSync(codec)(decoded)).toEqual(encoded);
    }
    const end = obj(Schema.encodeSync(codec)(events[6]!));
    expect(typeof obj(end.message ?? null).createdAt).toBe("string");
    expect(ChatStreamEvent.discriminants).toHaveLength(8);
    expect(ChatStreamEvent.guards.tasks_changed({ type: "tasks_changed" })).toBe(true);
  });
});
