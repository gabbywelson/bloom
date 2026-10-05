import { describe, expect, it } from "bun:test";
import { ConfigProvider, Effect } from "effect";
import { defaultRouting, parseRoute, routeFor, Routing } from "../src/index.ts";

const withEnv = (env: Record<string, string>) =>
  Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env));

describe("defaultRouting", () => {
  it("follows ADR 0008", () => {
    expect(defaultRouting).toEqual({
      conversation: { provider: "api_key", model: "claude-opus-5-5" },
      side_thread: { provider: "api_key", model: "claude-opus-5-5" },
      plan: { provider: "api_key", model: "claude-opus-5-5" },
      summarize: { provider: "api_key", model: "claude-haiku-4-5" },
      triage: { provider: "decision", model: "claude-haiku-4-5" },
    });
  });
});

describe("parseRoute", () => {
  const fallback = { provider: "api_key", model: "claude-opus-5-5" } as const;

  it("accepts provider:model", () => {
    expect(parseRoute("chatgpt_plan:gpt-5", fallback)).toEqual({
      provider: "chatgpt_plan",
      model: "gpt-5",
    });
  });

  it("keeps the fallback provider for a bare model", () => {
    expect(parseRoute(" claude-sonnet-4-5 ", fallback)).toEqual({
      provider: "api_key",
      model: "claude-sonnet-4-5",
    });
  });

  it("treats an unknown provider prefix as part of the model id", () => {
    expect(parseRoute("nope:thing", fallback)).toEqual({
      provider: "api_key",
      model: "nope:thing",
    });
  });

  it("falls back on an empty value", () => {
    expect(parseRoute("   ", fallback)).toEqual(fallback);
  });
});

describe("Routing.layer", () => {
  it("uses the defaults when no env vars are set", async () => {
    const table = await Effect.runPromise(
      Effect.map(Effect.service(Routing), (routing) => routing.table).pipe(
        Effect.provide(Routing.layer),
        withEnv({}),
      ),
    );
    expect(table).toEqual(defaultRouting);
  });

  it("applies BLOOM_MODEL_* overrides per run type", async () => {
    const program = Effect.gen(function* () {
      const conversation = yield* routeFor("conversation");
      const triage = yield* routeFor("triage");
      const summarize = yield* routeFor("summarize");
      return { conversation, triage, summarize };
    }).pipe(
      Effect.provide(Routing.layer),
      withEnv({
        BLOOM_MODEL_CONVERSATION: "chatgpt_plan:gpt-5",
        BLOOM_MODEL_TRIAGE: "claude-sonnet-4-5",
      }),
    );
    const routes = await Effect.runPromise(program);
    expect(routes.conversation).toEqual({ provider: "chatgpt_plan", model: "gpt-5" });
    expect(routes.triage).toEqual({ provider: "decision", model: "claude-sonnet-4-5" });
    expect(routes.summarize).toEqual(defaultRouting.summarize);
  });

  it("layerDefault ignores the environment", async () => {
    const route = await Effect.runPromise(
      routeFor("conversation").pipe(
        Effect.provide(Routing.layerDefault),
        withEnv({ BLOOM_MODEL_CONVERSATION: "chatgpt_plan:gpt-5" }),
      ),
    );
    expect(route).toEqual(defaultRouting.conversation);
  });
});
