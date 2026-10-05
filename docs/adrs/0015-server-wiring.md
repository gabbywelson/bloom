# 0015. Server wiring: one Layer tree, Better Auth mounted raw, pg-boss per job

Date: 2026-10-04

## Context

`apps/server` is the single long-running process. It composes the packages
and has to host three things that are not Effect-native: Better Auth
(Promise handler), pg-boss (Promise API with its own pool), and the static
web build.

## Decision

- **Layer tree.** `ServerLive` = HTTP routes + job scheduler + integration
  ingestion ← `AgentLive` ← `AgentClientsLive` ← `Auth` ← `DbLive` ←
  observability ← `ServerConfig`. Everything is a Layer; `main.ts` is
  `BunRuntime.runMain(Layer.launch(ServerLive))` guarded by
  `import.meta.main` so tests can import the tree.
- **Better Auth** is mounted as a raw router route `* /api/auth/*` that
  converts the Effect request to a Web `Request`, calls `auth.handler`, and
  converts the `Response` back. The `Auth` service owns the `pg` Pool via
  `acquireRelease`. The server's `onMagicLink` only logs a notice; the URL
  is printed solely by `bun run auth:link`, which builds its own `Auth` with
  a printing callback.
- **Authorization** forwards only the `cookie` header to
  `auth.api.getSession` (5 s timeout). Any auth failure becomes a 401, never
  a 500. All groups except `health` carry the middleware.
- **messages.send** does not append the user message; `AgentRunner` persists
  the user turn itself. The handler checks the thread exists (404 before
  any bytes), then streams the runner's events, ending the SSE cleanly after
  the runner's `error` event.
- **Static web build** is served from `BLOOM_WEB_DIST` (default
  `apps/web/build`) with `HttpStaticServer` in SPA mode (`200.html`), only
  for `Accept: text/html` requests and never for `/api*` paths. API and auth
  routes rank above the wildcard.
- **pg-boss** runs in schema `pgboss` with its OpenTelemetry integration off.
  Each `ScheduledJob` gets a queue (checked with `getQueue` first; `createQueue`
  is not idempotent in v12), a cron `schedule` with `singletonKey = name`, and a
  `work` handler with `batchSize: 1` that runs the job's Effect via the
  runtime captured at Layer build, inside a `job.<name>` span. A job defect is
  logged and swallowed so pg-boss does not retry it blindly.
  `BLOOM_JOBS_RUN_ON_START=true` sends each job once at boot (dev aid).
- **Tracing exclusion.** The HTTP tracer is disabled for
  `GET /api/auth/magic-link/verify`, whose query string carries the token;
  otherwise `url.full` would export the credential to Jaeger and Langfuse.
  pg-boss and pg pool shutdowns are bounded by timeouts so a dead database
  cannot hold SIGINT shutdown open.
- **Observability.** `Otlp.layerJson` is `provideMerge`d on top of the
  console logger so both loggers stay active. HTTP spans come from
  `HttpRouter.serve`; SQL and model spans from the packages. The local
  Jaeger is v2: query traces at `/api/v3/traces?query.service_name=...`
  with an explicit time range, not the legacy `/api/traces`.

## Consequences

- One process, one shutdown path: SIGINT closes the HTTP server, stops
  pg-boss gracefully, ends the pg pool, flushes OTLP.
- Integration toolkits are not yet merged into the agent's toolkit; that
  lands with the first real integration.
