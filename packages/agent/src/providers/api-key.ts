import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { Config, Context, Effect, Layer, Option, Schedule, Stream } from "effect";
import type { LanguageModel, Tool } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import {
  type DecideResult,
  type DecideSchema,
  fromLanguageModel,
  type GenerateResult,
  ModelError,
  type ModelStreamPart,
  type ProviderDecideRequest,
  type ProviderRequest,
  type ProviderShape,
} from "../provider.ts";

/** Anthropic client reading `ANTHROPIC_API_KEY`; fails at startup if the key is missing. */
export const AnthropicClientLive = AnthropicClient.layerConfig({
  apiKey: Config.Redacted("ANTHROPIC_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

/**
 * OpenAI client reading `OPENAI_API_KEY`. The key is optional so startup never
 * depends on it; without a key, any `gpt-*`/`o*` route fails with `ProviderUnavailable`.
 */
export const OpenAiClientLive = OpenAiClient.layerConfig({
  apiKey: Config.option(Config.Redacted("OPENAI_API_KEY")).pipe(Config.map(Option.getOrUndefined)),
}).pipe(Layer.provide(FetchHttpClient.layer));

/** Model ids served by OpenAI; everything else goes to Anthropic. */
export const isOpenAiModel = (model: string): boolean =>
  model.startsWith("gpt-") || model.startsWith("o");

/** Hard ceiling for a single non-streaming call. */
export const GENERATE_TIMEOUT = "90 seconds";

/**
 * Longest gap tolerated between two streamed parts (checked per pull, so it
 * bounds silence, not the whole response). Thinking and text deltas keep the
 * stream alive; a stalled connection trips it.
 */
export const STREAM_IDLE_TIMEOUT = "60 seconds";

const timedOut = (model: string): ModelError =>
  new ModelError({
    reason: "Upstream",
    provider: "api_key",
    model,
    message: `No answer within ${GENERATE_TIMEOUT}`,
  });

const idleTimedOut = (model: string): ModelError =>
  new ModelError({
    reason: "Upstream",
    provider: "api_key",
    model,
    message: `Stream silent for ${STREAM_IDLE_TIMEOUT}`,
  });

/**
 * Exponential backoff, three attempts in total, only for transient reasons.
 * Applied to calls without side effects only: `decide`, and `generate` without
 * a toolkit (with one, `generateText` runs the tool handlers inside the retried
 * region, so a late timeout would re-run `create_task`). Streams are never
 * retried: parts already emitted would be duplicated.
 */
export const retryPolicy = Schedule.max([
  Schedule.exponential("1 second"),
  Schedule.recurs(2),
]).pipe(
  Schedule.setInputType<ModelError>(),
  Schedule.while(({ input }) => input.isRetryable),
);

/**
 * Wraps a provider with Bloom's external-call discipline: timeouts on every
 * call, retries where repeating is safe (see `retryPolicy`), one span per method.
 */
export const withLimits = (base: ProviderShape): ProviderShape => {
  const generate = Effect.fn("ApiKeyProvider.generate")(function* <
    Tools extends Record<string, Tool.Any>,
  >(request: ProviderRequest<Tools>): Effect.fn.Return<GenerateResult<Tools>, ModelError> {
    const limited = base.generate(request).pipe(
      Effect.timeoutOrElse({
        duration: GENERATE_TIMEOUT,
        orElse: () => Effect.fail(timedOut(request.model)),
      }),
    );
    return yield* request.toolkit === undefined ? limited.pipe(Effect.retry(retryPolicy)) : limited;
  });

  const stream = <Tools extends Record<string, Tool.Any>>(
    request: ProviderRequest<Tools>,
  ): Stream.Stream<ModelStreamPart<Tools>, ModelError> =>
    base.stream(request).pipe(
      Stream.timeoutOrElse({
        duration: STREAM_IDLE_TIMEOUT,
        orElse: () => Stream.fail(idleTimedOut(request.model)),
      }),
      Stream.withSpan("ApiKeyProvider.stream"),
    );

  const decide = Effect.fn("ApiKeyProvider.decide")(function* <S extends DecideSchema>(
    request: ProviderDecideRequest<S>,
  ): Effect.fn.Return<DecideResult<S["Type"]>, ModelError> {
    return yield* base.decide(request).pipe(
      Effect.timeoutOrElse({
        duration: GENERATE_TIMEOUT,
        orElse: () => Effect.fail(timedOut(request.model)),
      }),
      Effect.retry(retryPolicy),
    );
  });

  return { generate, stream, decide };
};

/**
 * The real provider: Anthropic by default, OpenAI for `gpt-*`/`o*` ids. One
 * `LanguageModel` per model id, built lazily and memoized. Model defaults are
 * left untouched (Opus 5.5 always thinks; no thinking/temperature params are sent).
 */
export class ApiKeyProvider extends Context.Service<ApiKeyProvider, ProviderShape>()(
  "bloom/agent/providers/ApiKeyProvider",
) {
  static readonly layer = Layer.effect(
    ApiKeyProvider,
    Effect.gen(function* () {
      const anthropic = yield* AnthropicClient.AnthropicClient;
      const openai = yield* OpenAiClient.OpenAiClient;
      const openAiKeyPresent = yield* Config.option(Config.Redacted("OPENAI_API_KEY")).pipe(
        Effect.map(Option.isSome),
        Effect.orElseSucceed(() => false),
      );
      const models = new Map<string, LanguageModel.LanguageModel>();

      const build = (model: string): Effect.Effect<LanguageModel.LanguageModel, ModelError> => {
        if (isOpenAiModel(model)) {
          if (!openAiKeyPresent) {
            return Effect.fail(
              new ModelError({
                reason: "ProviderUnavailable",
                provider: "api_key",
                model,
                message: "OPENAI_API_KEY is not configured",
              }),
            );
          }
          return OpenAiLanguageModel.make({ model }).pipe(
            Effect.provideService(OpenAiClient.OpenAiClient, openai),
          );
        }
        return AnthropicLanguageModel.make({ model }).pipe(
          Effect.provideService(AnthropicClient.AnthropicClient, anthropic),
        );
      };

      const resolve = (model: string): Effect.Effect<LanguageModel.LanguageModel, ModelError> => {
        const cached = models.get(model);
        if (cached !== undefined) {
          return Effect.succeed(cached);
        }
        return build(model).pipe(
          Effect.tap((languageModel) =>
            Effect.sync(() => {
              models.set(model, languageModel);
            }),
          ),
        );
      };

      return ApiKeyProvider.of(withLimits(fromLanguageModel("api_key", resolve)));
    }),
  );
}
