import { describe, expect, it } from "bun:test";
import { Message, Thread } from "@bloom/domain";
import { Effect, Layer } from "effect";
import type { Prompt } from "effect/ai";
import { ContextAssembler, historyLimit, Soul, toPromptMessages } from "../src/index.ts";

const SOUL = "# Bloom\n\nYou are Bloom. Warm, calm, on Gabby's side.\n";

const layer = ContextAssembler.layer.pipe(Layer.provide(Soul.layerStatic(SOUL)));

const makeThread = (kind: "main" | "side", contextScope: "full" | "minimal") =>
  Effect.map(
    Thread.insert.makeEffect({
      kind,
      parentThreadId: null,
      topic: kind === "side" ? "rabbit hole" : null,
      contextScope,
      status: "active",
    }),
    (fields) => new Thread(fields),
  );

const makeMessage = (
  thread: Thread,
  role: "user" | "assistant" | "tool",
  parts: Message["parts"],
) =>
  Effect.map(
    Message.insert.makeEffect({ threadId: thread.id, role, parts, runId: null }),
    (fields) => new Message(fields),
  );

const userText = (thread: Thread, text: string) =>
  makeMessage(thread, "user", [{ type: "text", text }]);

const systemText = (prompt: Prompt.Prompt): string => {
  const first = prompt.content[0];
  if (first === undefined || first.role !== "system") {
    throw new Error("expected a leading system message");
  }
  return first.content;
};

describe("ContextAssembler", () => {
  it("puts SOUL.md, the time, the thread kind and the tools in the system prompt", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const assembler = yield* ContextAssembler;
        const thread = yield* makeThread("main", "full");
        const history = [yield* userText(thread, "hello")];
        return yield* assembler.assemble({
          thread,
          runType: "conversation",
          history,
          toolNames: ["create_task", "list_tasks"],
        });
      }).pipe(Effect.provide(layer)),
    );
    const system = systemText(result.prompt);
    expect(system.startsWith("# Bloom")).toBe(true);
    expect(system).toContain("You are Bloom.");
    expect(system).toMatch(/Now: \d{4}-\d{2}-\d{2}T/);
    expect(system).toContain("Thread: main");
    expect(system).toContain("Tools available: create_task, list_tasks");
    expect(result.prompt.content.map((message) => message.role)).toEqual(["system", "user"]);
    expect(result.summary).toEqual({ systemChars: system.length, messages: 1, scope: "full" });
  });

  it("keeps only the last 6 messages for a minimal-scope side thread", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const assembler = yield* ContextAssembler;
        const thread = yield* makeThread("side", "minimal");
        const history: Array<Message> = [];
        for (let i = 0; i < 10; i++) {
          history.push(yield* userText(thread, `m${i}`));
        }
        return yield* assembler.assemble({
          thread,
          runType: "side_thread",
          history,
          toolNames: [],
        });
      }).pipe(Effect.provide(layer)),
    );
    expect(historyLimit("minimal")).toBe(6);
    expect(historyLimit("full")).toBe(40);
    expect(result.summary.scope).toBe("minimal");
    expect(result.summary.messages).toBe(6);
    const texts = result.prompt.content
      .filter((message) => message.role === "user")
      .flatMap((message) => message.content.map((part) => (part.type === "text" ? part.text : "")));
    expect(texts).toEqual(["m4", "m5", "m6", "m7", "m8", "m9"]);
    expect(systemText(result.prompt)).toContain("Thread: side (rabbit hole)");
    expect(systemText(result.prompt)).toContain("Tools available: none");
  });

  it("maps tool parts to tool-call / tool-result prompt parts and UI parts to placeholders", async () => {
    const thread = await Effect.runPromise(makeThread("main", "full"));
    const assistant = await Effect.runPromise(
      makeMessage(thread, "assistant", [
        { type: "text", text: "On it." },
        { type: "tool_call", id: "c1", name: "create_task", args: { title: "Buy milk" } },
        {
          type: "tool_result",
          toolCallId: "c1",
          name: "create_task",
          ok: true,
          result: { id: "t1", title: "Buy milk" },
        },
        {
          type: "ui_component",
          component: { kind: "option_picker", prompt: "When?", options: [] },
        },
      ]),
    );
    const messages = toPromptMessages(assistant);
    expect(messages.map((message) => message.role)).toEqual(["assistant", "tool"]);
    const [assistantMessage, toolMessage] = messages;
    if (assistantMessage?.role !== "assistant" || toolMessage?.role !== "tool") {
      throw new Error("unexpected roles");
    }
    expect(assistantMessage.content.map((part) => part.type)).toEqual([
      "text",
      "tool-call",
      "text",
    ]);
    const call = assistantMessage.content[1];
    if (call?.type !== "tool-call") {
      throw new Error("expected tool-call");
    }
    expect(call.id).toBe("c1");
    expect(call.name).toBe("create_task");
    expect(call.params).toEqual({ title: "Buy milk" });
    const placeholder = assistantMessage.content[2];
    expect(placeholder?.type === "text" ? placeholder.text : "").toBe("[showed option_picker]");
    const result = toolMessage.content[0];
    if (result?.type !== "tool-result") {
      throw new Error("expected tool-result");
    }
    expect(result.id).toBe("c1");
    expect(result.isFailure).toBe(false);
    expect(result.result).toEqual({ id: "t1", title: "Buy milk" });
  });

  it("drops system messages and empty messages from history", async () => {
    const thread = await Effect.runPromise(makeThread("main", "full"));
    const empty = await Effect.runPromise(makeMessage(thread, "assistant", []));
    expect(toPromptMessages(empty)).toEqual([]);
  });
});
