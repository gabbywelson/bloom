import { describe, expect, it } from "bun:test";
import { Effect, Layer, Schema, Stream } from "effect";
import { Prompt } from "effect/ai";
import {
  ApiKeyProvider,
  ChatGptPlanProvider,
  DecisionProvider,
  failoverRoute,
  fromLanguageModel,
  makeFakeLanguageModel,
  ModelError,
  ModelProvider,
  reasonFromAiError,
  Routing,
  toModelError,
} from "../src/index.ts";
import { AiError } from "effect/ai";

/** An API-key provider that answers from a script instead of the network. */
const fakeApiKey = (texts: ReadonlyArray<string>) =>
  Layer.effect(
    ApiKeyProvider,
    Effect.map(makeFakeLanguageModel(texts.map((text) => ({ text }))), (languageModel) =>
      fromLanguageModel("api_key", () => Effect.succeed(languageModel)),
    ),
  );

const prompt = Prompt.make("hi");

const facade = (routing: Layer.Layer<Routing>, apiKey: Layer.Layer<ApiKeyProvider>) =>
  ModelProvider.layer.pipe(
    Layer.provide([routing, apiKey, ChatGptPlanProvider.layer, DecisionProvider.layer]),
  );

describe("ModelProvider failover", () => {
  const planFirst = Routing.layerStatic({
    conversation: { provider: "chatgpt_plan", model: "gpt-5" },
    side_thread: { provider: "api_key", model: "claude-opus-5-5" },
    plan: { provider: "api_key", model: "claude-opus-5-5" },
    summarize: { provider: "api_key", model: "claude-haiku-4-5" },
    triage: { provider: "decision", model: "claude-haiku-4-5" },
  });

  it("falls over from the ChatGPT plan stub to the api_key provider for generate", async () => {
    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const models = yield* ModelProvider;
        return yield* models.generate({ runType: "conversation", prompt });
      }).pipe(Effect.provide(facade(planFirst, fakeApiKey(["Hello from the fallback."])))),
    );
    expect(response.text).toBe("Hello from the fallback.");
  });

  it("falls over for stream as well", async () => {
    const text = await Effect.runPromise(
      Effect.gen(function* () {
        const models = yield* ModelProvider;
        return yield* models.stream({ runType: "conversation", prompt }).pipe(
          Stream.runFold(
            () => "",
            (acc, part) => (part.type === "text-delta" ? acc + part.delta : acc),
          ),
        );
      }).pipe(Effect.provide(facade(planFirst, fakeApiKey(["Streamed fallback"])))),
    );
    expect(text).toBe("Streamed fallback");
  });

  it("falls over to the run type's default api_key model", () => {
    expect(failoverRoute({ provider: "chatgpt_plan", model: "gpt-5" }, "conversation")).toEqual({
      provider: "api_key",
      model: "claude-opus-5-5",
    });
    expect(failoverRoute({ provider: "api_key", model: "x" }, "conversation")).toBeUndefined();
    expect(failoverRoute({ provider: "decision", model: "x" }, "triage")).toBeUndefined();
  });

  it("does not fail over from the decision stub (Invalid is not a failover reason)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const models = yield* ModelProvider;
        return yield* models.generate({ runType: "triage", prompt });
      }).pipe(Effect.provide(facade(Routing.layerDefault, fakeApiKey(["never"]))), Effect.result),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.reason).toBe("Invalid");
      expect(result.failure.provider).toBe("decision");
    }
  });

  it("decide on the decision route surfaces ProviderUnavailable", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const models = yield* ModelProvider;
        return yield* models.decide({
          runType: "triage",
          prompt,
          schema: Schema.Struct({ verdict: Schema.String }),
        });
      }).pipe(Effect.provide(facade(Routing.layerDefault, fakeApiKey([]))), Effect.result),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(ModelError);
      expect(result.failure.reason).toBe("ProviderUnavailable");
      expect(result.failure.provider).toBe("decision");
    }
  });
});

describe("ModelProvider.layerFake", () => {
  it("answers decide with the scripted object", async () => {
    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const models = yield* ModelProvider;
        const result = yield* models.decide({
          runType: "triage",
          prompt,
          schema: Schema.Struct({ verdict: Schema.Literals(["ignore", "nudge"]) }),
        });
        return result.value;
      }).pipe(Effect.provide(ModelProvider.layerFake([{ object: { verdict: "nudge" } }]))),
    );
    expect(value).toEqual({ verdict: "nudge" });
  });

  it("maps a scripted failure to the requested ModelError reason", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const models = yield* ModelProvider;
        return yield* models.generate({ runType: "conversation", prompt });
      }).pipe(Effect.provide(ModelProvider.layerFake([{ fail: "RateLimited" }])), Effect.result),
    );
    expect(result._tag === "Failure" && result.failure.reason).toBe("RateLimited");
  });
});

describe("ModelError mapping", () => {
  it("classifies AiError reasons", () => {
    expect(reasonFromAiError(new AiError.RateLimitError({}))).toBe("RateLimited");
    expect(reasonFromAiError(new AiError.AuthenticationError({ kind: "InvalidKey" }))).toBe(
      "ProviderUnavailable",
    );
    expect(reasonFromAiError(new AiError.InternalProviderError({ description: "x" }))).toBe(
      "Upstream",
    );
    expect(reasonFromAiError(new AiError.InvalidRequestError({}))).toBe("Invalid");
  });

  it("never leaks beyond the reason and the provider's description", () => {
    const error = toModelError(
      "api_key",
      "claude-opus-5-5",
    )(
      AiError.make({
        module: "Anthropic",
        method: "generateText",
        reason: new AiError.InvalidRequestError({ description: "bad request" }),
      }),
    );
    expect(error.reason).toBe("Invalid");
    expect(error.model).toBe("claude-opus-5-5");
    expect(error.message).toStartWith("InvalidRequestError: ");
    expect(error.message).toContain("bad request");
    expect(error.isRetryable).toBe(false);
    expect(error.shouldFailOver).toBe(false);
  });
});
