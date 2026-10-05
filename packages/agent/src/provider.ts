import type { RunType } from "@bloom/domain";
import { Cause, Effect, Schema, Stream } from "effect";
import {
  AiError,
  LanguageModel,
  type Prompt,
  type Response,
  type Tool,
  type Toolkit,
} from "effect/ai";
import { ProviderKind } from "./routing.ts";

/**
 * Coarse failure classes the rest of Bloom reasons about:
 * - `ProviderUnavailable`: this provider cannot serve the request at all (stub,
 *   missing key, auth failure, plan cap). Fail over if another provider can.
 * - `RateLimited`: temporary; retry with backoff or fail over.
 * - `Invalid`: the request or the model output was malformed; retrying is pointless.
 * - `Upstream`: network or provider-side failure; retryable.
 */
export const ModelErrorReason = Schema.Literals([
  "ProviderUnavailable",
  "RateLimited",
  "Invalid",
  "Upstream",
]);
export type ModelErrorReason = typeof ModelErrorReason.Type;

/**
 * The only error model consumers see. `message` is operator-facing and never
 * contains prompt or completion content; callers compose user-facing copy themselves.
 */
export class ModelError extends Schema.TaggedError<ModelError>()("ModelError", {
  reason: ModelErrorReason,
  provider: ProviderKind,
  model: Schema.String,
  message: Schema.String,
}) {
  /** Whether the same request may succeed if retried on the same provider. */
  get isRetryable(): boolean {
    return this.reason === "RateLimited" || this.reason === "Upstream";
  }

  /** Whether another provider should be tried for this request. */
  get shouldFailOver(): boolean {
    return this.reason === "ProviderUnavailable" || this.reason === "RateLimited";
  }
}

/** Maps Effect AI's fine-grained reasons onto Bloom's four classes. */
export const reasonFromAiError = (reason: AiError.AiErrorReason): ModelErrorReason => {
  switch (reason._tag) {
    case "RateLimitError":
    case "QuotaExhaustedError":
      return "RateLimited";
    case "AuthenticationError":
      return "ProviderUnavailable";
    case "NetworkError":
    case "InternalProviderError":
    case "UnknownError":
      return "Upstream";
    case "ContentPolicyError":
    case "InvalidRequestError":
    case "InvalidOutputError":
    case "StructuredOutputError":
    case "UnsupportedSchemaError":
    case "ToolNotFoundError":
    case "ToolParameterValidationError":
    case "InvalidToolResultError":
    case "ToolResultEncodingError":
    case "ToolConfigurationError":
    case "ToolkitRequiredError":
    case "InvalidUserInputError":
      return "Invalid";
  }
};

const MAX_MESSAGE_CHARS = 240;

const truncate = (text: string): string =>
  text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringField = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const field = value[key];
  return typeof field === "string" ? field : undefined;
};

/**
 * Classifies the payload of an `error` stream part. Providers emit these for
 * in-stream failures (Anthropic: SSE `error` events such as `rate_limit_error`
 * or `overloaded_error`) instead of failing the stream, so the shape is the
 * provider's own `{ type, message }` and unknown shapes count as `Upstream`.
 */
export const reasonFromErrorPart = (error: unknown): ModelErrorReason => {
  switch (stringField(error, "type")) {
    case "rate_limit_error":
      return "RateLimited";
    case "authentication_error":
    case "permission_error":
    case "billing_error":
      return "ProviderUnavailable";
    case "invalid_request_error":
    case "not_found_error":
      return "Invalid";
    default:
      return "Upstream";
  }
};

const fromErrorPart =
  (provider: ProviderKind, model: string) =>
  (error: unknown): ModelError =>
    new ModelError({
      reason: reasonFromErrorPart(error),
      provider,
      model,
      message: truncate(
        `error part: ${stringField(error, "type") ?? "unknown"}: ${stringField(error, "message") ?? ""}`,
      ),
    });

/**
 * Converts anything a `LanguageModel` call can fail with into a `ModelError`.
 * Only the reason tag and the provider's own description are kept (never prompt
 * content, which lives in the request, not the error).
 */
export const toModelError =
  (provider: ProviderKind, model: string) =>
  (error: unknown): ModelError => {
    if (error instanceof ModelError) {
      return error;
    }
    if (AiError.isAiError(error)) {
      return new ModelError({
        reason: reasonFromAiError(error.reason),
        provider,
        model,
        message: truncate(`${error.reason._tag}: ${error.reason.message}`),
      });
    }
    if (AiError.isAiErrorReason(error)) {
      return new ModelError({
        reason: reasonFromAiError(error),
        provider,
        model,
        message: truncate(`${error._tag}: ${error.message}`),
      });
    }
    if (Cause.isTimeoutError(error)) {
      return new ModelError({
        reason: "Upstream",
        provider,
        model,
        message: "The model did not answer in time",
      });
    }
    return new ModelError({
      reason: "Upstream",
      provider,
      model,
      message: truncate(error instanceof Error ? error.message : "Unexpected model failure"),
    });
  };

/** A text/tool request as the facade sees it (the route picks the model). */
export interface ModelRequest<Tools extends Record<string, Tool.Any>> {
  readonly runType: RunType;
  readonly prompt: Prompt.Prompt;
  /** Toolkit with handlers; the framework resolves tool calls and feeds results back. */
  readonly toolkit?: Toolkit.WithHandler<Tools> | undefined;
}

/** A text/tool request as a provider sees it (model already chosen). */
export interface ProviderRequest<
  Tools extends Record<string, Tool.Any>,
> extends ModelRequest<Tools> {
  readonly model: string;
}

/** Any schema whose encoded form is a JSON object; what structured output needs. */
export type DecideSchema = Schema.Codec<unknown, Record<string, unknown>, never, unknown>;

/** A typed judgment request: the model must answer with an object matching `schema`. */
export interface DecideRequest<S extends DecideSchema> {
  readonly runType: RunType;
  readonly prompt: Prompt.Prompt;
  readonly schema: S;
  readonly objectName?: string | undefined;
}

/** A typed judgment request as a provider sees it. */
export interface ProviderDecideRequest<S extends DecideSchema> extends DecideRequest<S> {
  readonly model: string;
}

/** Full response of a non-streaming call (text, tool calls, tool results, usage). */
export type GenerateResult<Tools extends Record<string, Tool.Any>> =
  LanguageModel.GenerateTextResponse<Tools, "opaque">;

/** Decoded structured output plus the usage that produced it. */
export interface DecideResult<A> {
  readonly value: A;
  readonly finishReason: Response.FinishReason;
  readonly usage: Response.Usage;
}

/** Stream parts as emitted by `LanguageModel.streamText` with tool resolution on. */
export type ModelStreamPart<Tools extends Record<string, Tool.Any>> = Response.StreamPart<
  Tools,
  "opaque"
>;

/**
 * The one interface every provider implements and the `ModelProvider` facade
 * exposes. `generate` and `stream` run the tool loop for a single round (tool
 * calls are executed and their results appear as parts); `decide` returns a typed object.
 */
export interface ProviderShape {
  readonly generate: <Tools extends Record<string, Tool.Any>>(
    request: ProviderRequest<Tools>,
  ) => Effect.Effect<GenerateResult<Tools>, ModelError>;
  readonly stream: <Tools extends Record<string, Tool.Any>>(
    request: ProviderRequest<Tools>,
  ) => Stream.Stream<ModelStreamPart<Tools>, ModelError>;
  readonly decide: <S extends DecideSchema>(
    request: ProviderDecideRequest<S>,
  ) => Effect.Effect<DecideResult<S["Type"]>, ModelError>;
}

/**
 * Builds a `ProviderShape` on top of Effect's `LanguageModel` service.
 *
 * `resolve` picks the concrete `LanguageModel` for a model id (Anthropic, OpenAI,
 * a fake). Tool-call resolution, `gen_ai.*` spans and structured-output parsing
 * all come from `effect/ai`; this helper only adapts the shape and the errors.
 */
export const fromLanguageModel = (
  provider: ProviderKind,
  resolve: (model: string) => Effect.Effect<LanguageModel.LanguageModel, ModelError>,
): ProviderShape => {
  const generate = <Tools extends Record<string, Tool.Any>>(
    request: ProviderRequest<Tools>,
  ): Effect.Effect<GenerateResult<Tools>, ModelError> =>
    resolve(request.model).pipe(
      Effect.flatMap((languageModel) => {
        // The toolkit's handler services are already captured by its Layer and
        // tool results are plain JSON, so the generic requirement/error types
        // collapse to `AiError` only; the cast records that.
        const effect =
          request.toolkit === undefined
            ? languageModel.generateText({ prompt: request.prompt })
            : languageModel.generateText({ prompt: request.prompt, toolkit: request.toolkit });
        // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- generic erasure; see comment above
        return effect as Effect.Effect<GenerateResult<Tools>, AiError.AiError>;
      }),
      Effect.mapError(toModelError(provider, request.model)),
    );

  const stream = <Tools extends Record<string, Tool.Any>>(
    request: ProviderRequest<Tools>,
  ): Stream.Stream<ModelStreamPart<Tools>, ModelError> =>
    resolve(request.model).pipe(
      Effect.map((languageModel) => {
        const parts =
          request.toolkit === undefined
            ? languageModel.streamText({ prompt: request.prompt })
            : languageModel.streamText({ prompt: request.prompt, toolkit: request.toolkit });
        // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- generic erasure; see `generate`
        return parts as Stream.Stream<ModelStreamPart<Tools>, AiError.AiError>;
      }),
      Stream.unwrap,
      Stream.mapError(toModelError(provider, request.model)),
      // An `error` part is the provider reporting failure in-band; surface it as
      // the stream's failure so callers see one error channel.
      Stream.mapEffect((part) =>
        part.type === "error"
          ? Effect.fail(fromErrorPart(provider, request.model)(part.error))
          : Effect.succeed(part),
      ),
    );

  const decide = <S extends DecideSchema>(
    request: ProviderDecideRequest<S>,
  ): Effect.Effect<DecideResult<S["Type"]>, ModelError> =>
    resolve(request.model).pipe(
      Effect.flatMap((languageModel) =>
        languageModel.generateObject({
          prompt: request.prompt,
          schema: request.schema,
          objectName: request.objectName,
        }),
      ),
      Effect.map((response): DecideResult<S["Type"]> => ({
        value: response.value,
        finishReason: response.finishReason,
        usage: response.usage,
      })),
      Effect.mapError(toModelError(provider, request.model)),
    );

  return { generate, stream, decide };
};

/** A provider whose every method fails with the same `ModelError`; used by the stubs. */
export const unavailableProvider = (
  provider: ProviderKind,
  reasons: { readonly generate: ModelErrorReason; readonly decide: ModelErrorReason },
  message: string,
): ProviderShape => {
  const fail = (reason: ModelErrorReason, model: string) =>
    new ModelError({ reason, provider, model, message });
  return {
    generate: (request) => Effect.fail(fail(reasons.generate, request.model)),
    stream: (request) => Stream.fail(fail(reasons.generate, request.model)),
    decide: (request) => Effect.fail(fail(reasons.decide, request.model)),
  };
};
