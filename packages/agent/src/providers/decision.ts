import { Context, Layer } from "effect";
import { type ProviderShape, unavailableProvider } from "../provider.ts";

/**
 * Decision provider: cheap, high-frequency typed judgments (triage). Planned
 * backend is Jev; until then a small model with structured output.
 *
 * STUB. `decide` fails with `ProviderUnavailable` ("Jev/decision model not wired
 * yet"); `generate` and `stream` fail with `Invalid` because this provider never
 * produces free text, so routing a text run here is a configuration mistake, not
 * an outage, and must not trigger failover.
 */
export class DecisionProvider extends Context.Service<DecisionProvider, ProviderShape>()(
  "bloom/agent/providers/DecisionProvider",
) {
  static readonly layer = Layer.succeed(
    DecisionProvider,
    unavailableProvider(
      "decision",
      { generate: "Invalid", decide: "ProviderUnavailable" },
      "Jev/decision model not wired yet",
    ),
  );
}
