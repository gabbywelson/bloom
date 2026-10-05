import { RunType } from "@bloom/domain";
import { Config, Context, Effect, Layer, Option, Schema } from "effect";

/** Which `ModelProvider` implementation serves a run type. */
export const ProviderKind = Schema.Literals(["api_key", "chatgpt_plan", "decision"]);
export type ProviderKind = typeof ProviderKind.Type;

/** One row of the routing table: provider + model id. */
export interface ModelRoute {
  readonly provider: ProviderKind;
  readonly model: string;
}

/**
 * Static routing defaults (ADR 0008). Conversation-quality first; background
 * runs never route to the ChatGPT plan so they cannot drain it.
 */
export const defaultRouting: Record<RunType, ModelRoute> = {
  conversation: { provider: "api_key", model: "claude-opus-5-5" },
  side_thread: { provider: "api_key", model: "claude-opus-5-5" },
  plan: { provider: "api_key", model: "claude-opus-5-5" },
  summarize: { provider: "api_key", model: "claude-haiku-4-5" },
  triage: { provider: "decision", model: "claude-haiku-4-5" },
};

/** Env var that overrides each run type's route. */
export const routingEnvVar: Record<RunType, string> = {
  conversation: "BLOOM_MODEL_CONVERSATION",
  side_thread: "BLOOM_MODEL_SIDE_THREAD",
  plan: "BLOOM_MODEL_PLAN",
  summarize: "BLOOM_MODEL_SUMMARIZE",
  triage: "BLOOM_MODEL_TRIAGE",
};

const isProviderKind = Schema.is(ProviderKind);

/**
 * Parses an override of the form `provider:model` or just `model`. A bare model
 * keeps the fallback's provider; an unknown provider prefix is treated as part
 * of the model id (model ids never contain `:` today, so this only matters for typos).
 */
export const parseRoute = (value: string, fallback: ModelRoute): ModelRoute => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  const separator = trimmed.indexOf(":");
  if (separator > 0) {
    const provider = trimmed.slice(0, separator);
    const model = trimmed.slice(separator + 1).trim();
    if (isProviderKind(provider) && model.length > 0) {
      return { provider, model };
    }
  }
  return { provider: fallback.provider, model: trimmed };
};

/** Routing table: run type → provider + model. Pure lookups, no I/O. */
export interface RoutingShape {
  readonly table: Record<RunType, ModelRoute>;
  readonly routeFor: (runType: RunType) => ModelRoute;
}

const makeRouting = (table: Record<RunType, ModelRoute>): RoutingShape => ({
  table,
  routeFor: (runType) => table[runType],
});

/** Reads `BLOOM_MODEL_*` overrides on top of `defaultRouting`. */
const loadRouting = Effect.gen(function* () {
  const table: Record<RunType, ModelRoute> = { ...defaultRouting };
  for (const runType of RunType.literals) {
    const override = yield* Config.option(Config.String(routingEnvVar[runType]));
    if (Option.isSome(override)) {
      table[runType] = parseRoute(override.value, defaultRouting[runType]);
    }
  }
  return makeRouting(table);
});

/**
 * Model routing service. `layer` reads `BLOOM_MODEL_<RUN_TYPE>` overrides
 * (`provider:model` or `model`) from Config; `layerDefault` is the ADR 0008 table.
 */
export class Routing extends Context.Service<Routing, RoutingShape>()("bloom/agent/Routing") {
  static readonly layer = Layer.effect(Routing, loadRouting);

  static readonly layerDefault = Layer.succeed(Routing, makeRouting(defaultRouting));

  static readonly layerStatic = (table: Record<RunType, ModelRoute>) =>
    Layer.succeed(Routing, makeRouting(table));
}

/** Looks up the route for a run type in the current `Routing`. */
export const routeFor = (runType: RunType): Effect.Effect<ModelRoute, never, Routing> =>
  Effect.map(Effect.service(Routing), (routing) => routing.routeFor(runType));
