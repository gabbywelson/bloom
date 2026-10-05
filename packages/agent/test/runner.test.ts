import { describe, expect, it } from "bun:test";
import { type ChatStreamEvent, MessageService, TaskService, ThreadService } from "@bloom/domain";
import type { AnthropicClient } from "@effect/ai-anthropic";
import type { OpenAiClient } from "@effect/ai-openai";
import { type Config, Effect, Layer, type PlatformError, Stream } from "effect";
import {
  AgentClientsLive,
  AgentLive,
  AgentRunner,
  BloomToolkitLive,
  ContextAssembler,
  type FakeTurn,
  ModelError,
  ModelProvider,
  Soul,
  closeOrphanToolCalls,
  MAX_TOOL_ROUNDS,
  ORPHAN_TOOL_RESULT,
  toPromptMessages,
  USER_FACING_EMPTY_REPLY,
  USER_FACING_MODEL_ERROR,
} from "../src/index.ts";

const domain = Layer.mergeAll(
  ThreadService.layerMemory,
  MessageService.layerMemory,
  TaskService.layerMemory,
);

const layerFor = (script: ReadonlyArray<FakeTurn>) =>
  AgentRunner.layer.pipe(
    Layer.provide([
      ContextAssembler.layer.pipe(Layer.provide(Soul.layerStatic("You are Bloom."))),
      BloomToolkitLive,
      ModelProvider.layerFake(script),
    ]),
    Layer.provideMerge(domain),
  );

/** Collects every event, keeping them even when the stream fails afterwards. */
const collect = <E>(stream: Stream.Stream<ChatStreamEvent, E>) =>
  Effect.gen(function* () {
    const events: Array<ChatStreamEvent> = [];
    const outcome = yield* stream.pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          events.push(event);
        }),
      ),
      Effect.result,
    );
    return { events, outcome };
  });

describe("AgentRunner", () => {
  it("creates a task via a tool call, then answers, and persists the whole turn", async () => {
    const script: ReadonlyArray<FakeTurn> = [
      { toolCalls: [{ name: "create_task", params: { title: "Call the dentist", effort: 2 } }] },
      { text: "Done. I added it." },
    ];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* AgentRunner;
        const threads = yield* ThreadService;
        const messages = yield* MessageService;
        const tasks = yield* TaskService;
        const thread = yield* threads.ensureMain;
        const { events, outcome } = yield* collect(
          runner.run({ threadId: thread.id, text: "remind me to call the dentist" }),
        );
        const history = yield* messages.list(thread.id);
        const taskList = yield* tasks.list();
        const touched = yield* threads.get(thread.id);
        return { events, outcome, history, taskList, touched };
      }).pipe(Effect.provide(layerFor(script))),
    );

    expect(result.outcome._tag).toBe("Success");
    const types = result.events.map((event) => event.type);
    expect(types.slice(0, 4)).toEqual([
      "message_start",
      "tool_call",
      "tool_result",
      "tasks_changed",
    ]);
    expect(types.at(-1)).toBe("message_end");
    const deltas = result.events.filter((event) => event.type === "text_delta");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((event) => (event.type === "text_delta" ? event.delta : "")).join("")).toBe(
      "Done. I added it.",
    );
    expect(types.slice(4, -1).every((type) => type === "text_delta")).toBe(true);

    expect(result.taskList).toHaveLength(1);
    expect(result.taskList[0]?.title).toBe("Call the dentist");
    expect(result.taskList[0]?.source).toBe("agent");

    expect(result.history.map((message) => message.role)).toEqual(["user", "assistant"]);
    const assistant = result.history[1];
    if (assistant === undefined) {
      throw new Error("assistant message missing");
    }
    expect(assistant.runId).not.toBeNull();
    // The agent.run trace id, so the reply can link to its trace (ADR 0024).
    expect(assistant.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(assistant.parts.map((part) => part.type)).toEqual(["tool_call", "tool_result", "text"]);
    const call = assistant.parts[0];
    const toolResult = assistant.parts[1];
    const text = assistant.parts[2];
    expect(call?.type === "tool_call" ? call.args : null).toEqual({
      title: "Call the dentist",
      effort: 2,
    });
    expect(toolResult?.type === "tool_result" ? toolResult.ok : null).toBe(true);
    expect(toolResult?.type === "tool_result" ? toolResult.toolCallId : null).toBe(
      call?.type === "tool_call" ? call.id : "",
    );
    expect(text?.type === "text" ? text.text : null).toBe("Done. I added it.");

    const end = result.events.at(-1);
    expect(end?.type === "message_end" ? end.message.id : null).toBe(assistant.id);
    expect(end?.type === "message_end" ? end.message.parts : null).toEqual(assistant.parts);
    expect(result.touched.lastMessageAt).not.toBeNull();
  });

  it("streams a plain answer without tools", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* AgentRunner;
        const threads = yield* ThreadService;
        const thread = yield* threads.ensureMain;
        return yield* collect(runner.run({ threadId: thread.id, text: "hi" }));
      }).pipe(Effect.provide(layerFor([{ text: "Hi. Quiet day?" }]))),
    );
    expect(result.outcome._tag).toBe("Success");
    const types = result.events.map((event) => event.type);
    expect(types[0]).toBe("message_start");
    expect(types.at(-1)).toBe("message_end");
    expect(types.includes("tool_call")).toBe(false);
    expect(types.includes("tasks_changed")).toBe(false);
  });

  it("emits a calm error event and persists partial parts when the model fails", async () => {
    const script: ReadonlyArray<FakeTurn> = [
      { toolCalls: [{ name: "create_task", params: { title: "Water the plants" } }] },
      { fail: "Upstream" },
    ];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* AgentRunner;
        const threads = yield* ThreadService;
        const messages = yield* MessageService;
        const thread = yield* threads.ensureMain;
        const { events, outcome } = yield* collect(
          runner.run({ threadId: thread.id, text: "water the plants later" }),
        );
        const history = yield* messages.list(thread.id);
        return { events, outcome, history };
      }).pipe(Effect.provide(layerFor(script))),
    );

    expect(result.outcome._tag).toBe("Failure");
    if (result.outcome._tag === "Failure") {
      expect(result.outcome.failure).toBeInstanceOf(ModelError);
      expect(result.outcome.failure._tag === "ModelError" && result.outcome.failure.reason).toBe(
        "Upstream",
      );
    }
    const types = result.events.map((event) => event.type);
    expect(types).toEqual(["message_start", "tool_call", "tool_result", "tasks_changed", "error"]);
    const last = result.events.at(-1);
    expect(last?.type === "error" ? last.message : null).toBe(USER_FACING_MODEL_ERROR);

    const assistant = result.history[1];
    expect(assistant?.parts.map((part) => part.type)).toEqual(["tool_call", "tool_result"]);
  });

  it("keeps text parts of different rounds apart even when the provider reuses text ids", async () => {
    // The fake uses Anthropic-style ids (content-block index "0" every response).
    const script: ReadonlyArray<FakeTurn> = [
      {
        text: "Adding it. ",
        toolCalls: [{ name: "create_task", params: { title: "Buy stamps" } }],
      },
      { text: "Done." },
    ];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* AgentRunner;
        const threads = yield* ThreadService;
        const messages = yield* MessageService;
        const thread = yield* threads.ensureMain;
        const { events, outcome } = yield* collect(
          runner.run({ threadId: thread.id, text: "remind me to buy stamps" }),
        );
        const history = yield* messages.list(thread.id);
        return { events, outcome, history };
      }).pipe(Effect.provide(layerFor(script))),
    );
    expect(result.outcome._tag).toBe("Success");
    const assistant = result.history[1];
    expect(assistant?.parts.map((part) => part.type)).toEqual([
      "text",
      "tool_call",
      "tool_result",
      "text",
    ]);
    const texts = (assistant?.parts ?? []).flatMap((part) =>
      part.type === "text" ? [part.text] : [],
    );
    expect(texts).toEqual(["Adding it. ", "Done."]);
    const end = result.events.at(-1);
    expect(end?.type === "message_end" ? end.message.parts : null).toEqual(
      assistant?.parts ?? null,
    );
  });

  it("closes an orphan tool_call when the tool rejects malformed parameters", async () => {
    const script: ReadonlyArray<FakeTurn> = [
      { toolCalls: [{ name: "create_task", params: { title: "Dentist", due: "tomorrow-ish" } }] },
    ];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* AgentRunner;
        const threads = yield* ThreadService;
        const messages = yield* MessageService;
        const tasks = yield* TaskService;
        const thread = yield* threads.ensureMain;
        const { events, outcome } = yield* collect(
          runner.run({ threadId: thread.id, text: "dentist tomorrow-ish" }),
        );
        const history = yield* messages.list(thread.id);
        const taskList = yield* tasks.list();
        return { events, outcome, history, taskList };
      }).pipe(Effect.provide(layerFor(script))),
    );

    expect(result.outcome._tag === "Failure" && result.outcome.failure._tag).toBe("ModelError");
    if (result.outcome._tag === "Failure" && result.outcome.failure._tag === "ModelError") {
      expect(result.outcome.failure.reason).toBe("Invalid");
    }
    expect(result.taskList).toHaveLength(0);
    expect(result.events.map((event) => event.type)).toEqual([
      "message_start",
      "tool_call",
      "tool_result",
      "error",
    ]);
    const toolResultEvent = result.events[2];
    expect(toolResultEvent?.type === "tool_result" ? toolResultEvent.ok : null).toBe(false);

    const assistant = result.history[1];
    if (assistant === undefined) {
      throw new Error("assistant message missing");
    }
    expect(assistant.parts.map((part) => part.type)).toEqual(["tool_call", "tool_result"]);
    const [call, toolResult] = assistant.parts;
    expect(toolResult?.type === "tool_result" ? toolResult.ok : null).toBe(false);
    expect(toolResult?.type === "tool_result" ? toolResult.result : null).toEqual(
      ORPHAN_TOOL_RESULT,
    );
    expect(toolResult?.type === "tool_result" ? toolResult.toolCallId : null).toBe(
      call?.type === "tool_call" ? call.id : "",
    );
    // The replayed history is well formed: every tool-call has a tool message.
    expect(toPromptMessages(assistant).map((message) => message.role)).toEqual([
      "assistant",
      "tool",
    ]);
  });

  it("closeOrphanToolCalls leaves answered calls alone", () => {
    expect(
      closeOrphanToolCalls([
        { type: "tool_call", id: "a", name: "list_tasks", args: {} },
        { type: "tool_result", toolCallId: "a", name: "list_tasks", ok: true, result: [] },
        { type: "text", text: "x" },
      ]),
    ).toEqual([]);
  });

  it("stops after MAX_TOOL_ROUNDS tool rounds and still ends the message", async () => {
    const script: ReadonlyArray<FakeTurn> = Array.from({ length: MAX_TOOL_ROUNDS + 1 }, () => ({
      toolCalls: [{ name: "list_tasks", params: {} }],
    }));
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* AgentRunner;
        const threads = yield* ThreadService;
        const thread = yield* threads.ensureMain;
        return yield* collect(runner.run({ threadId: thread.id, text: "what is on my plate?" }));
      }).pipe(Effect.provide(layerFor(script))),
    );
    expect(result.outcome._tag).toBe("Success");
    const types = result.events.map((event) => event.type);
    expect(types.filter((type) => type === "tool_call")).toHaveLength(MAX_TOOL_ROUNDS);
    expect(types.filter((type) => type === "tool_result")).toHaveLength(MAX_TOOL_ROUNDS);
    expect(types.at(-1)).toBe("message_end");
  });

  it("reports a turn that produced nothing instead of ending with an empty message", async () => {
    const layer = layerFor([{ finish: "content-filter" }]);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const threads = yield* ThreadService;
        const messages = yield* MessageService;
        const runner = yield* AgentRunner;
        const thread = yield* threads.ensureMain;
        const { events, outcome } = yield* collect(runner.run({ threadId: thread.id, text: "hi" }));
        const history = yield* messages.list(thread.id);
        return { events, outcome, history };
      }).pipe(Effect.provide(layer)),
    );
    expect(result.outcome._tag).toBe("Success");
    expect(result.events.map((event) => event.type)).toEqual(["message_start", "error"]);
    const error = result.events[1];
    expect(error?.type === "error" && error.message).toBe(USER_FACING_EMPTY_REPLY);
    const assistant = result.history.find((message) => message.role === "assistant");
    expect(assistant?.parts).toEqual([]);
  });

  it("persists the partial reply when the consumer disconnects mid-stream", async () => {
    const layer = layerFor([{ text: "one two three four five six seven eight" }]);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const threads = yield* ThreadService;
        const messages = yield* MessageService;
        const runner = yield* AgentRunner;
        const thread = yield* threads.ensureMain;
        // Taking two events (message_start + first text_delta) and walking away
        // interrupts the producer, like a client closing the SSE connection.
        const taken = yield* runner
          .run({ threadId: thread.id, text: "hi" })
          .pipe(Stream.take(2), Stream.runCollect);
        const history = yield* messages.list(thread.id);
        return { taken: Array.from(taken), history };
      }).pipe(Effect.provide(layer)),
    );
    expect(result.taken.map((event) => event.type)).toEqual(["message_start", "text_delta"]);
    const assistant = result.history.find((message) => message.role === "assistant");
    expect(assistant).toBeDefined();
    const text = assistant?.parts.find((part) => part.type === "text");
    expect(text?.type === "text" && text.text.length).toBeGreaterThan(0);
  });

  it("fails with ThreadNotFound before emitting anything for an unknown thread", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* AgentRunner;
        const threads = yield* ThreadService;
        const side = yield* threads.create({
          kind: "side",
          parentThreadId: null,
          topic: "x",
          status: "active",
        });
        const { events, outcome } = yield* collect(
          runner.run({ threadId: `${side.id}-missing` as typeof side.id, text: "hi" }),
        );
        return { events, outcome };
      }).pipe(Effect.provide(layerFor([{ text: "never" }]))),
    );
    expect(result.events).toEqual([]);
    expect(result.outcome._tag === "Failure" && result.outcome.failure._tag).toBe("ThreadNotFound");
  });
});

// Compile-time contract for apps/server: what AgentLive provides and still needs.

export const agentLiveContract: Layer.Layer<
  AgentRunner | ModelProvider,
  Config.ConfigError | PlatformError.PlatformError,
  | ThreadService
  | MessageService
  | TaskService
  | AnthropicClient.AnthropicClient
  | OpenAiClient.OpenAiClient
> = AgentLive;

export const agentClientsContract: Layer.Layer<
  AnthropicClient.AnthropicClient | OpenAiClient.OpenAiClient,
  Config.ConfigError
> = AgentClientsLive;
