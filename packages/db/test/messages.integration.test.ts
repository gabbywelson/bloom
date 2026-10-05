import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  Message,
  MessageId,
  type MessagePart,
  MessageService,
  Thread,
  ThreadService,
} from "@bloom/domain";
import { DateTime, Effect, Schema } from "effect";
import { ensureTestDatabase, makeTestRuntime, truncateAll } from "./helpers.ts";

const runtime = makeTestRuntime();
const messageId = Schema.decodeSync(MessageId);

beforeAll(async () => {
  await Effect.runPromise(ensureTestDatabase);
  await runtime.runPromise(Effect.void);
});
afterAll(() => runtime.dispose());
beforeEach(() => runtime.runPromise(truncateAll));

const richParts: ReadonlyArray<MessagePart> = [
  { type: "text", text: "hello" },
  { type: "image", url: "https://example.test/a.png", alt: "A" },
  {
    type: "tool_call",
    id: "c1",
    name: "create_task",
    // snake_case and camelCase keys must both survive untouched (transformJson is off).
    args: {
      title: "x",
      due_date: null,
      scheduledFor: "2026-10-06T09:00:00Z",
      nested: [1, { a_b: true }],
    },
  },
  {
    type: "tool_result",
    toolCallId: "c1",
    name: "create_task",
    ok: true,
    result: { taskId: "t1" },
  },
  {
    type: "ui_component",
    component: {
      kind: "confirm",
      prompt: "Send the reply?",
      confirmLabel: "Send",
      cancelLabel: "Not now",
      action: { name: "gmail.send_draft", args: { draft_id: "d1" } },
    },
  },
];

describe("MessageServiceDb", () => {
  it("round-trips parts through jsonb and keeps order for a burst of 50", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const threads = yield* ThreadService;
        const messages = yield* MessageService;
        const main = yield* threads.ensureMain;
        const other = yield* threads.create(
          yield* Schema.decodeEffect(Thread.jsonCreate)({ kind: "side" }),
        );

        const first = yield* messages.append({
          threadId: main.id,
          role: "user",
          parts: richParts,
        });
        expect(first).toBeInstanceOf(Message);
        expect(first.runId).toBeNull();
        expect(first.parts).toEqual(richParts);
        expect(DateTime.isUtc(first.createdAt)).toBe(true);

        const ids = [first.id];
        for (let i = 1; i < 50; i++) {
          const m = yield* messages.append({
            threadId: main.id,
            role: i % 2 === 0 ? "user" : "assistant",
            parts: [{ type: "text", text: `m${i}` }],
            runId: null,
          });
          ids.push(m.id);
        }
        yield* messages.append({
          threadId: other.id,
          role: "user",
          parts: [{ type: "text", text: "elsewhere" }],
        });

        const listed = yield* messages.list(main.id);
        expect(listed.map((m) => m.id)).toEqual(ids);
        expect(listed[0]?.parts).toEqual(richParts);
        expect(Message.text(listed[1] ?? first)).toBe("m1");

        expect((yield* messages.list(main.id, { limit: 3 })).map((m) => m.id)).toEqual(
          ids.slice(-3),
        );
        expect((yield* messages.list(main.id, { limit: 0 })).map((m) => m.id)).toEqual([]);
        expect((yield* messages.list(main.id, { limit: 500 })).map((m) => m.id)).toEqual(ids);
        expect((yield* messages.list(other.id)).map((m) => Message.text(m))).toEqual(["elsewhere"]);
      }),
    ));

  it("replaceParts updates parts without moving the message", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const threads = yield* ThreadService;
        const messages = yield* MessageService;
        const main = yield* threads.ensureMain;
        const a = yield* messages.append({
          threadId: main.id,
          role: "user",
          parts: [{ type: "text", text: "a" }],
        });
        const b = yield* messages.append({ threadId: main.id, role: "assistant", parts: [] });
        const c = yield* messages.append({
          threadId: main.id,
          role: "user",
          parts: [{ type: "text", text: "c" }],
        });

        const replaced = yield* messages.replaceParts(b.id, [
          { type: "text", text: "streamed" },
          { type: "tool_call", id: "x", name: "list_tasks", args: {} },
        ]);
        expect(replaced.parts).toHaveLength(2);
        expect(replaced.id).toBe(b.id);
        expect(DateTime.toEpochMillis(replaced.createdAt)).toBe(
          DateTime.toEpochMillis(b.createdAt),
        );

        const listed = yield* messages.list(main.id);
        expect(listed.map((m) => m.id)).toEqual([a.id, b.id, c.id]);
        expect(listed[1]?.parts).toHaveLength(2);

        const error = yield* Effect.flip(messages.replaceParts(messageId("missing"), []));
        expect(error._tag).toBe("MessageNotFound");
      }),
    ));
});
