import type { RunType } from "@bloom/domain";
import { Context, Effect, Layer, Ref, Stream } from "effect";
import { AiError, LanguageModel, type Response, type Tool } from "effect/ai";
import {
  type DecideRequest,
  type DecideResult,
  type DecideSchema,
  fromLanguageModel,
  type GenerateResult,
  ModelError,
  type ModelErrorReason,
  type ModelRequest,
  type ModelStreamPart,
  type ProviderShape,
} from "./provider.ts";
import { ApiKeyProvider } from "./providers/api-key.ts";
import { ChatGptPlanProvider } from "./providers/chatgpt-plan.ts";
import { DecisionProvider } from "./providers/decision.ts";
import { defaultRouting, type ModelRoute, type ProviderKind, Routing } from "./routing.ts";

/** What the rest of Bloom calls. Routing and failover are hidden behind it. */
export interface ModelProviderShape {
  readonly generate: <Tools extends Record<string, Tool.Any>>(
    request: ModelRequest<Tools>,
  ) => Effect.Effect<GenerateResult<Tools>, ModelError>;
  readonly stream: <Tools extends Record<string, Tool.Any>>(
    request: ModelRequest<Tools>,
  ) => Stream.Stream<ModelStreamPart<Tools>, ModelError>;
  readonly decide: <S extends DecideSchema>(
    request: DecideRequest<S>,
  ) => Effect.Effect<DecideResult<S["Type"]>, ModelError>;
}

/**
 * Where a ChatGPT-plan route falls over to: the API-key provider with the run
 * type's default model. Only the plan provider fails over; the others are either
 * the fallback itself or deliberately typed (decision) and must surface errors.
 */
export const failoverRoute = (route: ModelRoute, runType: RunType): ModelRoute | undefined =>
  route.provider === "chatgpt_plan"
    ? { provider: "api_key", model: defaultRouting[runType].model }
    : undefined;

const shouldFailOver = (error: ModelError): boolean => error.shouldFailOver;

const logFailover = (
  route: ModelRoute,
  fallback: ModelRoute,
  runType: RunType,
  error: ModelError,
) =>
  Effect.logWarning("model provider failover").pipe(
    Effect.annotateLogs({
      "bloom.run_type": runType,
      "bloom.model.from": `${route.provider}:${route.model}`,
      "bloom.model.to": `${fallback.provider}:${fallback.model}`,
      "bloom.model.reason": error.reason,
    }),
  );

const routeAttributes = (route: ModelRoute, runType: RunType) => ({
  "bloom.run_type": runType,
  "bloom.model.provider": route.provider,
  "bloom.model.id": route.model,
});

/** One scripted model turn for `ModelProvider.layerFake`. */
export interface FakeTurn {
  /** Assistant text, streamed as text-start / word deltas / text-end. */
  readonly text?: string | undefined;
  /** Tool calls the fake model "decides" to make; handlers run for real. */
  readonly toolCalls?:
    | ReadonlyArray<{ readonly name: string; readonly params: unknown }>
    | undefined;
  /** Structured output for `decide` (serialized as the text the parser reads). */
  readonly object?: unknown;
  /** Fail this turn with a `ModelError` of the given reason instead of answering. */
  readonly fail?: ModelErrorReason | undefined;
  /** Override the finish reason (default: "tool-calls" with tool calls, else "stop"). */
  readonly finish?: Response.FinishPartEncoded["reason"] | undefined;
}

const aiErrorFor = (reason: ModelErrorReason, method: string): AiError.AiError => {
  const inner: AiError.AiErrorReason =
    reason === "RateLimited"
      ? new AiError.RateLimitError({})
      : reason === "ProviderUnavailable"
        ? new AiError.AuthenticationError({ kind: "MissingKey", description: "scripted failure" })
        : reason === "Invalid"
          ? new AiError.InvalidRequestError({ description: "scripted failure" })
          : new AiError.InternalProviderError({ description: "scripted failure" });
  return AiError.make({ module: "FakeLanguageModel", method, reason: inner });
};

const fakeUsage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } };

const streamPartsFor = (turn: FakeTurn, index: number): Array<Response.StreamPartEncoded> => {
  const parts: Array<Response.StreamPartEncoded> = [
    { type: "response-metadata", id: `fake-${index}`, modelId: "fake" },
  ];
  const text = turn.object !== undefined ? JSON.stringify(turn.object) : turn.text;
  if (text !== undefined) {
    // Anthropic-style id: the content-block index, which restarts every response.
    const id = "0";
    parts.push({ type: "text-start", id });
    for (const delta of text.match(/\S+\s*|\s+/g) ?? []) {
      parts.push({ type: "text-delta", id, delta });
    }
    parts.push({ type: "text-end", id });
  }
  const toolCalls = turn.toolCalls ?? [];
  toolCalls.forEach((call, callIndex) => {
    parts.push({
      type: "tool-call",
      id: `call-${index}-${callIndex}`,
      name: call.name,
      params: call.params,
    });
  });
  parts.push({
    type: "finish",
    reason: turn.finish ?? (toolCalls.length > 0 ? "tool-calls" : "stop"),
    usage: fakeUsage,
  });
  return parts;
};

const generatePartsFor = (turn: FakeTurn, index: number): Array<Response.PartEncoded> => {
  const parts: Array<Response.PartEncoded> = [
    { type: "response-metadata", id: `fake-${index}`, modelId: "fake" },
  ];
  const text = turn.object !== undefined ? JSON.stringify(turn.object) : turn.text;
  if (text !== undefined) {
    parts.push({ type: "text", text });
  }
  const toolCalls = turn.toolCalls ?? [];
  toolCalls.forEach((call, callIndex) => {
    parts.push({
      type: "tool-call",
      id: `call-${index}-${callIndex}`,
      name: call.name,
      params: call.params,
    });
  });
  parts.push({
    type: "finish",
    reason: turn.finish ?? (toolCalls.length > 0 ? "tool-calls" : "stop"),
    usage: fakeUsage,
  });
  return parts;
};

/**
 * A `LanguageModel` driven by a script. Each model call consumes the next turn,
 * so a two-turn script answers a tool round and then a final text. Tool calls go
 * through the real `effect/ai` resolution machinery (handlers execute, results
 * stream back), which is what makes it a faithful stand-in for the runner.
 */
export const makeFakeLanguageModel = (
  script: ReadonlyArray<FakeTurn>,
): Effect.Effect<LanguageModel.LanguageModel> =>
  Effect.gen(function* () {
    const cursor = yield* Ref.make(0);
    const nextTurn = (method: string) =>
      Ref.modify(cursor, (index) => [{ turn: script[index], index }, index + 1] as const).pipe(
        Effect.flatMap(({ turn, index }) =>
          turn === undefined
            ? Effect.fail(
                AiError.make({
                  module: "FakeLanguageModel",
                  method,
                  reason: new AiError.InternalProviderError({
                    description: `fake script exhausted after ${index} turns`,
                  }),
                }),
              )
            : turn.fail !== undefined
              ? Effect.fail(aiErrorFor(turn.fail, method))
              : Effect.succeed({ turn, index }),
        ),
      );

    return yield* LanguageModel.make({
      generateText: () =>
        nextTurn("generateText").pipe(
          Effect.map(({ turn, index }) => generatePartsFor(turn, index)),
        ),
      streamText: () =>
        nextTurn("streamText").pipe(
          Effect.map(({ turn, index }) =>
            Stream.fromIterable(streamPartsFor(turn, index), { chunkSize: 1 }),
          ),
          Stream.unwrap,
        ),
    });
  });

/**
 * The model facade. `layer` routes by run type (`Routing`) and fails over from
 * the ChatGPT plan to the API key on `ProviderUnavailable`/`RateLimited`;
 * `layerFake(script)` is a deterministic stand-in for tests.
 */
export class ModelProvider extends Context.Service<ModelProvider, ModelProviderShape>()(
  "bloom/agent/ModelProvider",
) {
  static readonly layer = Layer.effect(
    ModelProvider,
    Effect.gen(function* () {
      const routing = yield* Routing;
      const apiKey = yield* ApiKeyProvider;
      const chatGptPlan = yield* ChatGptPlanProvider;
      const decision = yield* DecisionProvider;

      const providers: Record<ProviderKind, ProviderShape> = {
        api_key: apiKey,
        chatgpt_plan: chatGptPlan,
        decision,
      };

      const generate = Effect.fn("ModelProvider.generate")(function* <
        Tools extends Record<string, Tool.Any>,
      >(request: ModelRequest<Tools>): Effect.fn.Return<GenerateResult<Tools>, ModelError> {
        const route = routing.routeFor(request.runType);
        yield* Effect.annotateCurrentSpan(routeAttributes(route, request.runType));
        const primary = providers[route.provider].generate({ ...request, model: route.model });
        const fallback = failoverRoute(route, request.runType);
        if (fallback === undefined) {
          return yield* primary;
        }
        return yield* primary.pipe(
          Effect.catchIf(shouldFailOver, (error) =>
            logFailover(route, fallback, request.runType, error).pipe(
              Effect.andThen(
                providers[fallback.provider].generate({ ...request, model: fallback.model }),
              ),
            ),
          ),
        );
      });

      const stream = <Tools extends Record<string, Tool.Any>>(
        request: ModelRequest<Tools>,
      ): Stream.Stream<ModelStreamPart<Tools>, ModelError> => {
        const route = routing.routeFor(request.runType);
        const primary = providers[route.provider].stream({ ...request, model: route.model });
        const fallback = failoverRoute(route, request.runType);
        const withFailover =
          fallback === undefined
            ? primary
            : primary.pipe(
                Stream.catchIf(shouldFailOver, (error) =>
                  logFailover(route, fallback, request.runType, error).pipe(
                    Effect.map(() =>
                      providers[fallback.provider].stream({ ...request, model: fallback.model }),
                    ),
                    Stream.unwrap,
                  ),
                ),
              );
        return withFailover.pipe(
          Stream.withSpan("ModelProvider.stream", {
            attributes: routeAttributes(route, request.runType),
          }),
        );
      };

      const decide = Effect.fn("ModelProvider.decide")(function* <S extends DecideSchema>(
        request: DecideRequest<S>,
      ): Effect.fn.Return<DecideResult<S["Type"]>, ModelError> {
        const route = routing.routeFor(request.runType);
        yield* Effect.annotateCurrentSpan(routeAttributes(route, request.runType));
        const primary = providers[route.provider].decide({ ...request, model: route.model });
        const fallback = failoverRoute(route, request.runType);
        if (fallback === undefined) {
          return yield* primary;
        }
        return yield* primary.pipe(
          Effect.catchIf(shouldFailOver, (error) =>
            logFailover(route, fallback, request.runType, error).pipe(
              Effect.andThen(
                providers[fallback.provider].decide({ ...request, model: fallback.model }),
              ),
            ),
          ),
        );
      });

      return ModelProvider.of({ generate, stream, decide });
    }),
  );

  /** Deterministic facade for tests: every run type is served by the scripted fake. */
  static readonly layerFake = (script: ReadonlyArray<FakeTurn>) =>
    Layer.effect(
      ModelProvider,
      Effect.gen(function* () {
        const languageModel = yield* makeFakeLanguageModel(script);
        const provider = fromLanguageModel("api_key", () => Effect.succeed(languageModel));
        return ModelProvider.of({
          generate: (request) => provider.generate({ ...request, model: "fake" }),
          stream: (request) => provider.stream({ ...request, model: "fake" }),
          decide: (request) => provider.decide({ ...request, model: "fake" }),
        });
      }),
    );
}
