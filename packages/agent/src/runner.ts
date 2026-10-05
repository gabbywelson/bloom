import {
  type ChatStreamEvent,
  type Message,
  type MessagePart,
  MessageService,
  RunId,
  type RunType,
  type ThreadId,
  ThreadNotFound,
  ThreadService,
} from "@bloom/domain";
import { Context, DateTime, Effect, Layer, Queue, Result, Schema, Stream } from "effect";
import { Prompt, type Response } from "effect/ai";
import { ContextAssembler } from "./context.ts";
import { ModelProvider } from "./model-provider.ts";
import type { ModelError, ModelStreamPart } from "./provider.ts";
import { ApiKeyProvider, AnthropicClientLive, OpenAiClientLive } from "./providers/api-key.ts";
import { ChatGptPlanProvider } from "./providers/chatgpt-plan.ts";
import { DecisionProvider } from "./providers/decision.ts";
import { Routing } from "./routing.ts";
import { Soul } from "./soul.ts";
import { BloomToolkit, BloomToolkitLive, type BloomTools } from "./tools.ts";

/** Input of one conversational turn. */
export interface RunInput {
  readonly threadId: ThreadId;
  readonly text: string;
}

/** Why a run can fail: no such thread, or the model layer gave up. */
export type RunError = ThreadNotFound | ModelError;

/** Upper bound on tool rounds per turn; keeps a confused model from looping. */
export const MAX_TOOL_ROUNDS = 4;

/** What the user sees when the model layer fails; calm, no internals. */
export const USER_FACING_MODEL_ERROR =
  "I couldn't reach my thinking right now. Nothing was lost; try again in a moment.";

/** What the user sees when the model finished without saying or doing anything. */
export const USER_FACING_EMPTY_REPLY = "I came up empty on that one. Could you say it another way?";

/** Streams one agent turn as `ChatStreamEvent`s and persists the assistant message. */
export interface AgentRunnerShape {
  readonly run: (input: RunInput) => Stream.Stream<ChatStreamEvent, RunError>;
}

const runTypeFor = (kind: "main" | "side" | "quest"): RunType =>
  kind === "side" ? "side_thread" : "conversation";

const decodeJson = Schema.decodeUnknownEffect(Schema.Json);

/** Best-effort JSON view of a tool payload; anything non-JSON becomes `null`. */
const toJson = (value: unknown): Effect.Effect<Schema.Json> =>
  decodeJson(value).pipe(Effect.orElseSucceed((): Schema.Json => null));

const decodeRunId = Schema.decodeUnknownEffect(RunId);

const newRunId: Effect.Effect<RunId> = Effect.sync(() => crypto.randomUUID()).pipe(
  Effect.flatMap(decodeRunId),
  Effect.orDie,
);

/** What a tool call that never produced a result is recorded as. */
export const ORPHAN_TOOL_RESULT: Schema.Json = {
  error: "tool failed before producing a result",
};

/**
 * Pairs every `tool_call` with a `tool_result`. A tool whose handler fails under
 * `failureMode: "error"` ends the model stream after the call part was emitted
 * (see `Toolkit.handle`), leaving a call without a result; providers reject such
 * history on every later turn, so the gap is closed with a failed result.
 * Returns the synthesized results so the caller can also emit them.
 */
export const closeOrphanToolCalls = (
  parts: ReadonlyArray<MessagePart>,
): ReadonlyArray<Extract<MessagePart, { type: "tool_result" }>> => {
  const answered = new Set<string>();
  for (const part of parts) {
    if (part.type === "tool_result") {
      answered.add(part.toolCallId);
    }
  }
  const orphans: Array<Extract<MessagePart, { type: "tool_result" }>> = [];
  for (const part of parts) {
    if (part.type === "tool_call" && !answered.has(part.id)) {
      orphans.push({
        type: "tool_result",
        toolCallId: part.id,
        name: part.name,
        ok: false,
        result: ORPHAN_TOOL_RESULT,
      });
      answered.add(part.id);
    }
  }
  return orphans;
};

/**
 * The agent loop (ARCHITECTURE.md "Agent runtime"): resolve the thread, persist
 * the user turn, assemble context, stream the model with tools for up to
 * `MAX_TOOL_ROUNDS`, persist the assistant turn, touch the thread.
 */
export class AgentRunner extends Context.Service<AgentRunner, AgentRunnerShape>()(
  "bloom/agent/AgentRunner",
) {
  static readonly layer = Layer.effect(
    AgentRunner,
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const messages = yield* MessageService;
      const assembler = yield* ContextAssembler;
      const models = yield* ModelProvider;
      const toolkit = yield* BloomToolkit;
      const toolNames = Object.keys(toolkit.tools);

      const runTurn = Effect.fn("AgentRunner.turn")(function* (
        input: RunInput,
        emit: (event: ChatStreamEvent) => Effect.Effect<void>,
      ): Effect.fn.Return<void, RunError> {
        const thread = yield* threads.get(input.threadId);
        const runType = runTypeFor(thread.kind);
        yield* Effect.annotateCurrentSpan("bloom.run_type", runType);

        yield* messages.append({
          threadId: thread.id,
          role: "user",
          parts: [{ type: "text", text: input.text }],
        });
        const history = yield* messages.list(thread.id, { limit: 40 });
        const assembled = yield* assembler.assemble({ thread, runType, history, toolNames });
        yield* Effect.annotateCurrentSpan({
          "bloom.context.system_chars": assembled.summary.systemChars,
          "bloom.context.messages": assembled.summary.messages,
          "bloom.context.scope": assembled.summary.scope,
        });

        const runId = yield* newRunId;
        const assistant = yield* messages.append({
          threadId: thread.id,
          role: "assistant",
          parts: [],
          runId,
        });
        yield* emit({ type: "message_start", messageId: assistant.id, threadId: thread.id });

        // Mutable per-turn state; one fiber owns it. `textIndex` maps a provider
        // text-part id to its slot in `parts` and is scoped to one model round:
        // Anthropic ids are content-block indexes that restart at "0" every response.
        const parts: Array<MessagePart> = [];
        const textIndex = new Map<string, number>();
        let prompt = assembled.prompt;
        let lastFinish: Response.FinishPart["reason"] | undefined;

        const onPart = Effect.fnUntraced(function* (
          part: ModelStreamPart<BloomTools>,
        ): Effect.fn.Return<void, ModelError> {
          switch (part.type) {
            case "text-delta": {
              const index = textIndex.get(part.id);
              if (index === undefined) {
                textIndex.set(part.id, parts.length);
                parts.push({ type: "text", text: part.delta });
              } else {
                const existing = parts[index];
                if (existing?.type === "text") {
                  parts[index] = { type: "text", text: existing.text + part.delta };
                }
              }
              yield* emit({ type: "text_delta", messageId: assistant.id, delta: part.delta });
              return;
            }
            case "tool-call": {
              const args = yield* toJson(part.params);
              parts.push({ type: "tool_call", id: part.id, name: part.name, args });
              yield* emit({
                type: "tool_call",
                messageId: assistant.id,
                toolCallId: part.id,
                name: part.name,
                args,
              });
              return;
            }
            case "tool-result": {
              if (part.preliminary) {
                return;
              }
              const result = yield* toJson(part.encodedResult);
              const ok = !part.isFailure;
              parts.push({ type: "tool_result", toolCallId: part.id, name: part.name, ok, result });
              yield* emit({
                type: "tool_result",
                messageId: assistant.id,
                toolCallId: part.id,
                name: part.name,
                ok,
              });
              if (ok && part.name === "create_task") {
                yield* emit({ type: "tasks_changed" });
              }
              return;
            }
            case "finish": {
              lastFinish = part.reason;
              return;
            }
            default:
              return;
          }
        });

        const rounds = Effect.gen(function* () {
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            textIndex.clear();
            const roundParts: Array<Response.AnyPart> = [];
            yield* models.stream({ runType, prompt, toolkit }).pipe(
              Stream.runForEach((part) =>
                Effect.sync(() => {
                  roundParts.push(part);
                }).pipe(Effect.andThen(onPart(part))),
              ),
            );
            const calledTools = roundParts.some((part) => part.type === "tool-call");
            if (!calledTools) {
              return;
            }
            prompt = Prompt.concat(prompt, Prompt.fromResponseParts(roundParts));
          }
          yield* Effect.logWarning("agent run stopped after max tool rounds").pipe(
            Effect.annotateLogs({ "bloom.thread_id": thread.id, "bloom.rounds": MAX_TOOL_ROUNDS }),
          );
        });

        // The HTTP layer interrupts the run when the client goes away (and Bun
        // used to do it after 10 idle seconds); keep what the model produced.
        const persistOnInterrupt = messages
          .replaceParts(assistant.id, parts)
          .pipe(
            Effect.ignore,
            Effect.andThen(
              Effect.logWarning("agent run interrupted; partial output persisted").pipe(
                Effect.annotateLogs({ "bloom.thread_id": thread.id, "bloom.parts": parts.length }),
              ),
            ),
          );
        const outcome = yield* Effect.result(
          rounds.pipe(Effect.onInterrupt(() => persistOnInterrupt)),
        );

        // A failed round can leave a tool call without its result; close it so
        // the stored history stays replayable, and tell the client the call ended.
        for (const orphan of closeOrphanToolCalls(parts)) {
          parts.push(orphan);
          yield* emit({
            type: "tool_result",
            messageId: assistant.id,
            toolCallId: orphan.toolCallId,
            name: orphan.name,
            ok: false,
          });
        }

        // Persist whatever we have, success or not: partial output is still history.
        const persisted = yield* messages.replaceParts(assistant.id, parts).pipe(Effect.orDie);
        const now = yield* DateTime.now;
        yield* threads.touch(thread.id, now);

        if (Result.isFailure(outcome)) {
          const error = outcome.failure;
          yield* Effect.logWarning("agent run failed at the model layer").pipe(
            Effect.annotateLogs({
              "bloom.thread_id": thread.id,
              "bloom.run_type": runType,
              "bloom.model.reason": error.reason,
              "bloom.model.provider": error.provider,
              "bloom.parts": parts.length,
            }),
          );
          yield* emit({ type: "error", message: USER_FACING_MODEL_ERROR });
          return yield* error;
        }

        if (parts.length === 0) {
          // A refusal, a length cut-off before any text, or a provider quirk:
          // ending with an empty message would look like Bloom went quiet.
          yield* Effect.logWarning("agent run produced no output").pipe(
            Effect.annotateLogs({
              "bloom.thread_id": thread.id,
              "bloom.run_type": runType,
              "bloom.finish_reason": lastFinish ?? "none",
            }),
          );
          yield* emit({ type: "error", message: USER_FACING_EMPTY_REPLY });
          return;
        }

        yield* emit({ type: "message_end", message: toJsonMessage(persisted) });
      });

      const run = (input: RunInput): Stream.Stream<ChatStreamEvent, RunError> =>
        Stream.callback<ChatStreamEvent, RunError>((queue) =>
          runTurn(input, (event) => Queue.offer(queue, event).pipe(Effect.asVoid)).pipe(
            Effect.matchCauseEffect({
              onFailure: (cause) => Queue.failCause(queue, cause),
              onSuccess: () => Queue.end(queue),
            }),
          ),
        ).pipe(
          Stream.withSpan("agent.run", {
            attributes: { "bloom.thread_id": input.threadId },
          }),
        );

      return AgentRunner.of({ run });
    }),
  );
}

/** A persisted message in the shape the stream contract carries (`Message.json` type). */
const toJsonMessage = (message: Message): typeof Message.json.Type => message;

/** Model clients the server provides (API keys from Config). */
export const AgentClientsLive = Layer.mergeAll(AnthropicClientLive, OpenAiClientLive);

/**
 * The whole agent runtime. Requires the domain services (`ThreadService`,
 * `MessageService`, `TaskService`) and the model clients (`AgentClientsLive`).
 * Exposes `AgentRunner` and `ModelProvider` (the pipeline needs the latter directly).
 */
export const AgentLive = AgentRunner.layer.pipe(
  Layer.provide([ContextAssembler.layer.pipe(Layer.provide(Soul.layer)), BloomToolkitLive]),
  Layer.provideMerge(
    ModelProvider.layer.pipe(
      Layer.provide([
        Routing.layer,
        ApiKeyProvider.layer,
        ChatGptPlanProvider.layer,
        DecisionProvider.layer,
      ]),
    ),
  ),
);
