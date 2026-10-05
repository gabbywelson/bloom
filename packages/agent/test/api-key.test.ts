import { describe, expect, it } from "bun:test";
import { Effect, Fiber, Ref, Stream } from "effect";
import { AiError, LanguageModel, Prompt, type Response } from "effect/ai";
import { TestClock } from "effect/testing";
import {
  fromLanguageModel,
  ModelError,
  reasonFromErrorPart,
  retryPolicy,
  STREAM_IDLE_TIMEOUT,
  withLimits,
} from "../src/index.ts";

const prompt = Prompt.make("hi");

const failing = (reason: ModelError["reason"]) =>
  new ModelError({ reason, provider: "api_key", model: "fake", message: "scripted" });

/** Counts attempts of an always-failing call under `retryPolicy`, with the clock driven by hand. */
const attemptsUnderRetry = (reason: ModelError["reason"]) =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const fiber = yield* Ref.update(attempts, (n) => n + 1).pipe(
      Effect.andThen(Effect.fail(failing(reason))),
      Effect.retry(retryPolicy),
      Effect.result,
      Effect.forkChild,
    );
    // Backoff is 1s then 2s; move well past both.
    for (let i = 0; i < 6; i++) {
      yield* TestClock.adjust("1 second");
    }
    const outcome = yield* Fiber.join(fiber);
    return { attempts: yield* Ref.get(attempts), outcome };
  }).pipe(Effect.provide(TestClock.layer()));

describe("retryPolicy", () => {
  it("retries transient failures: three attempts in total", async () => {
    const { attempts, outcome } = await Effect.runPromise(attemptsUnderRetry("Upstream"));
    expect(attempts).toBe(3);
    expect(outcome._tag).toBe("Failure");
  });

  it("does not retry Invalid", async () => {
    const { attempts } = await Effect.runPromise(attemptsUnderRetry("Invalid"));
    expect(attempts).toBe(1);
  });
});

/** A model whose stream never emits and whose generate never answers. */
const stalledModel = LanguageModel.make({
  generateText: () => Effect.never,
  streamText: () => Stream.never,
});

/** A model that reports failure in-band with an `error` part, Anthropic style. */
const errorPartModel = (error: unknown) =>
  LanguageModel.make({
    generateText: () =>
      Effect.fail(
        AiError.make({
          module: "Test",
          method: "generateText",
          reason: new AiError.InternalProviderError({ description: "unused" }),
        }),
      ),
    streamText: () =>
      Stream.fromIterable<Response.StreamPartEncoded>([
        { type: "response-metadata", id: "r1", modelId: "fake" },
        { type: "text-start", id: "0" },
        { type: "text-delta", id: "0", delta: "partial" },
        { type: "error", error },
      ]),
  });

describe("withLimits", () => {
  it("fails a silent stream with an Upstream ModelError after STREAM_IDLE_TIMEOUT", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const languageModel = yield* stalledModel;
        const provider = withLimits(
          fromLanguageModel("api_key", () => Effect.succeed(languageModel)),
        );
        const fiber = yield* provider
          .stream({ runType: "conversation", prompt, model: "claude-opus-5-5" })
          .pipe(Stream.runCollect, Effect.result, Effect.forkChild);
        yield* TestClock.adjust(STREAM_IDLE_TIMEOUT);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(ModelError);
      expect(result.failure.reason).toBe("Upstream");
      expect(result.failure.model).toBe("claude-opus-5-5");
      expect(result.failure.message).toContain(STREAM_IDLE_TIMEOUT);
    }
  });
});

describe("error stream parts", () => {
  it("classifies provider error payloads", () => {
    expect(reasonFromErrorPart({ type: "rate_limit_error", message: "slow down" })).toBe(
      "RateLimited",
    );
    expect(reasonFromErrorPart({ type: "authentication_error" })).toBe("ProviderUnavailable");
    expect(reasonFromErrorPart({ type: "invalid_request_error" })).toBe("Invalid");
    expect(reasonFromErrorPart({ type: "overloaded_error" })).toBe("Upstream");
    expect(reasonFromErrorPart("garbage")).toBe("Upstream");
  });

  it("fails the stream with a ModelError carrying the route's provider and model", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const languageModel = yield* errorPartModel({
          type: "rate_limit_error",
          message: "Too many requests",
        });
        const provider = fromLanguageModel("api_key", () => Effect.succeed(languageModel));
        const seen: Array<string> = [];
        const outcome = yield* provider
          .stream({ runType: "conversation", prompt, model: "claude-haiku-4-5" })
          .pipe(
            Stream.runForEach((part) =>
              Effect.sync(() => {
                seen.push(part.type);
              }),
            ),
            Effect.result,
          );
        return { seen, outcome };
      }),
    );
    expect(result.seen).toContain("text-delta");
    expect(result.outcome._tag).toBe("Failure");
    if (result.outcome._tag === "Failure") {
      expect(result.outcome.failure.reason).toBe("RateLimited");
      expect(result.outcome.failure.provider).toBe("api_key");
      expect(result.outcome.failure.model).toBe("claude-haiku-4-5");
      expect(result.outcome.failure.message).toContain("rate_limit_error");
    }
  });
});
