/**
 * Boundary rule (CLAUDE.md, ARCHITECTURE.md "Repo structure"): integrations
 * never import `@bloom/agent`. They expose tools and emit Events only through
 * the interfaces in `@bloom/domain`; this file imports from `effect` and
 * `@bloom/domain` and nothing else.
 */
import type { EventSink } from "@bloom/domain";
import type { Layer } from "effect";
import type { Toolkit } from "effect/ai";

/**
 * Services apps/server provides to every integration's tool handlers and
 * ingestion Layer. Widen this union (never a single integration's Layer type)
 * when an integration needs another domain service.
 */
export type IntegrationRequirements = EventSink;

/**
 * The tools half of an integration: definitions plus the handlers that run
 * them. A `Toolkit` is an Effect that requires `Tool.HandlersFor<Tools>`, so
 * definitions alone cannot be executed; `handlers` is `toolkit.toLayer({...})`
 * (its `ROut` is contravariant, so it is assignable to `Layer<never>`).
 *
 * apps/server merges definitions with `Toolkit.merge(...)` and provides
 * `Layer.mergeAll(...)` of every integration's `handlers` to the agent run.
 */
export interface IntegrationTools {
  readonly toolkit: Toolkit.Any;
  readonly handlers: Layer.Layer<never, never, IntegrationRequirements>;
}

/**
 * One external source. `tools` are surfaced to the agent during a run;
 * `ingestion` is a background Layer (webhook listener, poller) that writes
 * Events through `EventSink`. Either half may be absent.
 */
export interface Integration {
  readonly name: string;
  readonly description: string;
  readonly tools: IntegrationTools | undefined;
  readonly ingestion: Layer.Layer<never, never, IntegrationRequirements> | undefined;
}

/** Identity helper that pins the integration shape at the definition site. */
export const defineIntegration = (integration: Integration): Integration => integration;
