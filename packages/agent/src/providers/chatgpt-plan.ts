import { Context, Layer } from "effect";
import { type ProviderShape, unavailableProvider } from "../provider.ts";

/**
 * Sign in with ChatGPT provider: conversational turns billed to Gabby's plan.
 *
 * STUB. Every method fails with `ModelError{ reason: "ProviderUnavailable" }`.
 *
 * Failover contract (what `ModelProvider` relies on, and what the real
 * implementation must keep):
 * - Cap exhaustion, an expired or missing sign-in, and provider outages surface
 *   as `ProviderUnavailable`; 429s as `RateLimited`. Both make the facade fall
 *   over to `ApiKeyProvider` with that run type's default API model and a warn log.
 * - `Invalid` and `Upstream` are NOT failed over (same request would fail anywhere
 *   or the fallback would double-spend on a flaky request); they reach the caller.
 * - Streams must fail before emitting any part when they are going to fail at all
 *   for a fail-over reason, so the fallback can restart the turn cleanly.
 * - Background run types never route here (ADR 0008), so the plan cannot be drained.
 */
export class ChatGptPlanProvider extends Context.Service<ChatGptPlanProvider, ProviderShape>()(
  "bloom/agent/providers/ChatGptPlanProvider",
) {
  static readonly layer = Layer.succeed(
    ChatGptPlanProvider,
    unavailableProvider(
      "chatgpt_plan",
      { generate: "ProviderUnavailable", decide: "ProviderUnavailable" },
      "Sign in with ChatGPT is not implemented yet",
    ),
  );
}
