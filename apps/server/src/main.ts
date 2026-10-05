/**
 * bloom-server: the one long-running process. Composition, outermost first:
 *
 *   HTTP + job scheduler (+ integration ingestion, none yet)
 *     <- agent runtime <- model clients <- Better Auth <- database
 *     <- logging/telemetry <- configuration
 *
 * Launch from the repo root so Bun loads `.env`. Missing `DATABASE_URL` or
 * `BETTER_AUTH_SECRET` fails the config layer before anything connects.
 */
import { AgentClientsLive, AgentLive } from "@bloom/agent";
import { DbLive } from "@bloom/db";
import { integrations } from "@bloom/integrations";
import { BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Auth } from "./auth/service.ts";
import { ServerConfig } from "./config.ts";
import { HttpLive } from "./http/server.ts";
import { JobScheduler } from "./jobs/scheduler.ts";
import { ObservabilityLive } from "./observability.ts";

/** Background ingestion of every integration that has one (empty today; iterated generically). */
export const IngestionLive = Layer.mergeAll(
  Layer.empty,
  ...integrations.flatMap((integration) =>
    integration.ingestion === undefined ? [] : [integration.ingestion],
  ),
);

/** The whole server. Exposes `HttpServer` (via `HttpLive`) so tests can read the bound port. */
export const ServerLive = Layer.mergeAll(HttpLive, JobScheduler.layer, IngestionLive).pipe(
  Layer.provide(AgentLive),
  Layer.provide(AgentClientsLive),
  Layer.provide(Auth.layer),
  Layer.provide(DbLive),
  Layer.provide(ObservabilityLive),
  Layer.provide(ServerConfig.layer),
);

if (import.meta.main) {
  BunRuntime.runMain(
    Layer.launch(ServerLive).pipe(
      Effect.tapCause((cause) => Effect.logFatal("bloom-server failed to start", cause)),
    ),
  );
}
