import {
  type ContextScope,
  type Message,
  MessagePart,
  type RunType,
  type Thread,
} from "@bloom/domain";
import { Context, DateTime, Effect, Layer } from "effect";
import { Prompt } from "effect/ai";
import { Soul } from "./soul.ts";

/** Everything a run contributes to its own context. */
export interface AssembleInput {
  readonly thread: Thread;
  readonly runType: RunType;
  /** Chronological; already limited by the caller, further limited by scope here. */
  readonly history: ReadonlyArray<Message>;
  /** Names of the tools this run may call; listed in the system prompt. */
  readonly toolNames: ReadonlyArray<string>;
}

/** What gets logged per run so a reply can be replayed without logging content. */
export interface ContextSummary {
  readonly systemChars: number;
  readonly messages: number;
  readonly scope: ContextScope;
}

/** The assembled prompt plus its summary. */
export interface AssembledContext {
  readonly prompt: Prompt.Prompt;
  readonly summary: ContextSummary;
}

/** Side threads are tangents: they see only the tail of their own history. */
export const historyLimit = (scope: ContextScope): number => (scope === "minimal" ? 6 : 40);

/** System prompt: persona first, then the few facts that change per run. */
export const systemPrompt = (
  soul: string,
  input: {
    readonly now: DateTime.Utc;
    readonly thread: Thread;
    readonly toolNames: ReadonlyArray<string>;
  },
): string => {
  const topic = input.thread.topic === null ? "" : ` (${input.thread.topic})`;
  const tools = input.toolNames.length === 0 ? "none" : input.toolNames.join(", ");
  return [
    soul.trimEnd(),
    "",
    `Now: ${DateTime.formatIso(input.now)}`,
    `Thread: ${input.thread.kind}${topic}`,
    `Tools available: ${tools}`,
  ].join("\n");
};

/**
 * Maps one stored message onto prompt messages. Text stays text; prior tool
 * use is replayed as tool-call / tool-result parts so the model sees what it
 * already did; UI components become a short placeholder. Tool results travel in
 * their own `tool` message because providers require that ordering, and a call
 * without a result in the same message is skipped for the same reason.
 */
export const toPromptMessages = (message: Message): Array<Prompt.Message> => {
  if (message.role === "system") {
    return [];
  }
  const assistantParts: Array<Prompt.AssistantMessagePart> = [];
  const userParts: Array<Prompt.UserMessagePart> = [];
  const toolParts: Array<Prompt.ToolMessagePart> = [];
  const isAssistant = message.role === "assistant";
  // Providers reject a tool call with no result in the next message; a call
  // left unanswered in a stored row (older rows, interrupted runs) is dropped.
  const answered = new Set<string>();
  for (const part of message.parts) {
    if (part.type === "tool_result") {
      answered.add(part.toolCallId);
    }
  }

  for (const part of message.parts) {
    MessagePart.match(part, {
      text: ({ text }) => {
        const textPart = Prompt.makePart("text", { text });
        if (isAssistant) {
          assistantParts.push(textPart);
        } else {
          userParts.push(textPart);
        }
      },
      image: ({ url, alt }) => {
        const textPart = Prompt.makePart("text", { text: `[image: ${alt ?? url}]` });
        if (isAssistant) {
          assistantParts.push(textPart);
        } else {
          userParts.push(textPart);
        }
      },
      tool_call: ({ id, name, args }) => {
        if (!answered.has(id)) {
          return;
        }
        assistantParts.push(
          Prompt.makePart("tool-call", { id, name, params: args, providerExecuted: false }),
        );
      },
      tool_result: ({ toolCallId, name, ok, result }) => {
        toolParts.push(
          Prompt.makePart("tool-result", {
            id: toolCallId,
            name,
            isFailure: !ok,
            result,
            providerExecuted: false,
          }),
        );
      },
      ui_component: ({ component }) => {
        const textPart = Prompt.makePart("text", { text: `[showed ${component.kind}]` });
        if (isAssistant) {
          assistantParts.push(textPart);
        } else {
          userParts.push(textPart);
        }
      },
    });
  }

  const messages: Array<Prompt.Message> = [];
  if (userParts.length > 0) {
    messages.push(Prompt.makeMessage("user", { content: userParts }));
  }
  if (assistantParts.length > 0) {
    messages.push(Prompt.makeMessage("assistant", { content: assistantParts }));
  }
  if (toolParts.length > 0) {
    messages.push(Prompt.makeMessage("tool", { content: toolParts }));
  }
  return messages;
};

/** Builds the per-run prompt: SOUL.md + run facts + scoped thread history. */
export interface ContextAssemblerShape {
  readonly assemble: (input: AssembleInput) => Effect.Effect<AssembledContext>;
}

/**
 * Context assembly (ARCHITECTURE.md "Context assembly", steps 1, 4 and 5).
 * The "today" snapshot and memories (steps 2 and 3) arrive with their integrations.
 */
export class ContextAssembler extends Context.Service<ContextAssembler, ContextAssemblerShape>()(
  "bloom/agent/ContextAssembler",
) {
  static readonly layer = Layer.effect(
    ContextAssembler,
    Effect.gen(function* () {
      const soul = yield* Soul;

      const assemble = Effect.fn("ContextAssembler.assemble")(function* (input: AssembleInput) {
        const soulText = yield* soul.text;
        const now = yield* DateTime.now;
        const system = systemPrompt(soulText, {
          now,
          thread: input.thread,
          toolNames: input.toolNames,
        });

        const scope = input.thread.contextScope;
        const limit = historyLimit(scope);
        const recent = input.history.slice(Math.max(0, input.history.length - limit));
        const historyMessages = recent.flatMap(toPromptMessages);

        const prompt = Prompt.fromMessages([
          Prompt.makeMessage("system", { content: system }),
          ...historyMessages,
        ]);
        const summary: ContextSummary = {
          systemChars: system.length,
          messages: historyMessages.length,
          scope,
        };
        // Info on purpose (ARCHITECTURE.md: log the assembled context per run);
        // counts and scope only, never content.
        yield* Effect.logInfo("context assembled").pipe(
          Effect.annotateLogs({
            "bloom.thread_id": input.thread.id,
            "bloom.run_type": input.runType,
            "bloom.context.system_chars": summary.systemChars,
            "bloom.context.messages": summary.messages,
            "bloom.context.scope": summary.scope,
          }),
        );
        return { prompt, summary };
      });

      return ContextAssembler.of({ assemble });
    }),
  );
}
