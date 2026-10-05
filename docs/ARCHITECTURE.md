# Architecture

This document describes what is actually built as of the Phase 0 skeleton
(2026-10-04). The product intent lives in `VISION.md`; individual decisions
live in `adrs/`. Where this file and an ADR disagree, the ADR is newer.

## Shape

One long-running Bun process (`apps/server`) owns everything: the HTTP API,
auth, the agent runtime, scheduled jobs and telemetry export. Clients are
thin and talk only to the API. Postgres is the only state. Everything on the
server is Effect: services are `Context.Service` tags, wiring is Layers,
errors are tagged, every service method has a span.

```
browser (SvelteKit SPA, :5173 in dev)
   │  same origin: Vite proxies /api → :3000  (ADR 0004)
   ▼
apps/server (Bun + Effect)                         ┌──────────────┐
   /api/auth/*  → Better Auth (passkeys, magic link) │ OTel collector│→ Jaeger
   /api/*       → HttpApi handlers ──┐               │   :4318       │→ Langfuse
   /*           → static web build   │ spans/logs ──▶└──────────────┘
                                     ▼
            AgentRunner ─ ModelProvider ─ Anthropic / OpenAI
                 │
            domain services (Task, Thread, Message, EventSink)
                 │
            Postgres (migrations, repos, pg-boss schema)
```

## Repo layout

```
apps/
  server/      Bun + Effect process: config, auth, http groups, jobs, main.ts, cli/
  web/         SvelteKit 3 + Svelte 5 runes SPA (adapter-static, PWA, Playwright e2e)
  ios/         SwiftUI app (XcodeGen project.yml; Bloom app, BloomKit framework, tests)
packages/
  domain/      Effect Schema entities (Model.Class), branded ids, unions, service tags
  api/         HttpApi contract, Authorization middleware tag, derived client, openapi.json
               (+ the OpenAPI transform and the recorded chat-stream fixtures)
  db/          migrations, repositories, DB-backed service Layers, migrate/seed scripts
  agent/       ModelProvider + providers, routing, SOUL loader, context assembly, tools, runner
  pipeline/    scheduled jobs (heartbeat), interruption policy v1
  integrations/ Integration interface + registry (empty today)
docs/          VISION, ARCHITECTURE (this), SOUL.md, adrs/
docker/        OTel collector config, Postgres init SQL
repos/         vendored reference sources (Effect 4), read-only
```

Dependency rules: `apps/*` import `packages/*`, never the reverse.
`integrations` never imports `agent`. Agent tools mutate state only through
the domain service tags. `domain` depends on `effect` alone.

## Stack as built

| Layer       | Choice                                    | Notes                                                                                                                                                                            |
| ----------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime     | Bun 1.3                                   | Scripts run from the repo root so `.env` loads                                                                                                                                   |
| Framework   | Effect 4.0.0                              | `effect/http-api`, `effect/sql`, `effect/ai`, `effect/observability` from core; `@effect/platform-bun`, `@effect/sql-pg`, `@effect/ai-anthropic`, `@effect/ai-openai` (ADR 0002) |
| Database    | Postgres 17 (docker)                      | `effect/sql` + `Model.Class` variants, no ORM (ADR 0002, 0009, 0012)                                                                                                             |
| Jobs        | pg-boss 12                                | schema `pgboss`, one queue per job (ADR 0015)                                                                                                                                    |
| Auth        | Better Auth 1.7 + `@better-auth/passkey`  | CLI-issued magic link bootstraps the first session (ADR 0003)                                                                                                                    |
| Web         | SvelteKit 3, Svelte 5 runes, Vite 8       | SPA mode, service worker, manifest (ADR 0016)                                                                                                                                    |
| Models      | `effect/ai` LanguageModel                 | Opus 5.5 for conversation, Haiku 4.5 for cheap runs (ADR 0008, 0013)                                                                                                             |
| Telemetry   | OTLP/HTTP to a local collector            | fan-out to Jaeger and Langfuse (ADR 0005, 0010)                                                                                                                                  |
| Lint/format | Oxlint (Effect presets) + Oxfmt, Lefthook | ADR 0001                                                                                                                                                                         |
| Tests       | `bun test`                                | in-memory Layers for domain/api/agent; real Postgres (`bloom_test`) for db                                                                                                       |

## Data model (as implemented)

All entities are `Model.Class` declarations in `packages/domain` with three
database variants (`select`/`insert`/`update`) and three JSON variants
(`json`/`jsonCreate`/`jsonUpdate`). Ids are branded UUIDv7 strings generated
by `Entity.insert.makeEffect`. Timestamps are `DateTime.Utc` in code, `Date`
in the database, ISO strings on the wire. Server-managed timestamps never
appear in client create/update payloads. Tables add a `seq` identity column
used as the ordering tiebreaker (ADR 0012).

| Entity        | Fields (abridged)                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Task`        | title, notes, status (inbox/next/scheduled/waiting/done/dropped), due, scheduledFor, effort 1–5, energyKind, area, source, parentId, completedAt |
| `Thread`      | kind (main/side/quest), parentThreadId, topic, contextScope (full/minimal; side defaults to minimal), status, lastMessageAt                      |
| `Message`     | threadId, role, parts (jsonb array of `MessagePart`), runId                                                                                      |
| `MessagePart` | `text`, `image`, `tool_call`, `tool_result`, `ui_component` (discriminated on `type`)                                                            |
| `UiComponent` | `option_picker`, `task_card`, `confirm`, `snooze_picker` (discriminated on `kind`)                                                               |
| `Event`       | source, type, occurredAt, payload (jsonb), dedupeKey (partial unique); append-only                                                               |
| `Nudge`       | triggerEventId, body, reasoning, channel, actions (non-empty), sentAt, outcome, outcomeAt, messageId                                             |
| `Capture`     | kind (text/voice/share/image), payload, transcript, status, routedTo                                                                             |

Not yet modelled: Routine, Chore, Area, Item, Memory, CheckIn (listed in
VISION and the brief; deferred past Phase 0).

Domain **service tags** (`TaskService`, `ThreadService`, `MessageService`,
`CaptureService`, `EventSink`) are declared in `domain` with in-memory Layers
for tests and implemented in `db`. Every task and capture mutation writes an
audit `Event` (`source: "domain"`) in the same transaction; capture events
never include the payload (ADR 0019). `ChatStreamEvent` is the SSE
contract between server and clients.

## How a message flows (read this in ten minutes)

1. **Browser.** The page holds one `ManagedRuntime` built from
   `BloomClient.layer()` (ADR 0016). Pressing send calls
   `client.messages.send({ params: { id: threadId }, payload: { text } })`.
   The derived client encodes the request from the same `HttpApi` value the
   server implements; there are no hand-written fetches (ADR 0007). The
   request goes to `/api/threads/:id/messages` on the same origin; in dev
   Vite proxies it to the Bun server, carrying the Better Auth session
   cookie.

2. **HTTP.** `HttpRouter.serve` opens the request span (`http.server POST`).
   The route belongs to the `messages` group, which carries the
   `Authorization` middleware. The middleware forwards only the cookie header
   to Better Auth's `getSession` (5 s timeout, `auth.session` span) and
   provides `CurrentUser`, or fails with a 401 `Unauthorized`.

3. **Handler.** The `messages.send` handler confirms the thread exists
   (`ThreadService.get`, 404 otherwise) and returns the `Stream` from
   `AgentRunner.run({ threadId, text })`. Because the endpoint's success
   schema is `HttpApiSchema.StreamSse({ data: ChatStreamEvent })`, the
   framework encodes each event as an SSE `data:` line and streams it.

4. **Runner** (`packages/agent/src/runner.ts`, span `agent.run`).
   Appends the user message through `MessageService`, loads the last 40
   messages (6 for side threads), and asks `ContextAssembler` for a prompt:
   `SOUL.md` as the system prompt, a "now" line, then the history mapped to
   `effect/ai` `Prompt` messages, including prior tool calls and results. It
   creates the assistant `Message` row with empty parts and emits
   `message_start`.

5. **Model.** `ModelProvider.stream({ runType: "conversation", prompt,
toolkit })` looks up the routing table (ADR 0008), delegates to
   `ApiKeyProvider`, which runs `LanguageModel.streamText` against
   `claude-opus-5-5` through `@effect/ai-anthropic`. The provider emits the
   `gen_ai.*` span that Langfuse understands. Text deltas become
   `text_delta` events. If the model calls `create_task`, `effect/ai` runs
   the toolkit handler, which decodes the arguments with `Task.jsonCreate`
   and calls `TaskService.create(input, "agent")`; the runner emits
   `tool_call`, `tool_result` and `tasks_changed`, appends the round's parts
   to the prompt, and calls the model again (at most 4 rounds).

6. **Persistence.** `TaskService.create` (db implementation) inserts the
   task and a `task.created` audit `Event` in one transaction. When the
   stream ends, the runner replaces the assistant message's parts with the
   accumulated text and tool parts, touches the thread's `lastMessageAt`,
   and emits `message_end` carrying the persisted message. On a model
   failure it persists the partial parts, emits a calm `error` event, then
   fails the stream; the handler ends the SSE response cleanly (ADR 0013).

7. **Browser again.** `sendMessage` folds each event through the pure
   reducer in `src/lib/chat.ts`: an empty assistant bubble on
   `message_start`, text accumulating on `text_delta`, tool parts rendered as
   quiet "used create_task" lines, a task-list refetch on `tasks_changed`,
   and the final message swapped in on `message_end`.

8. **Trace.** Every span above shares the trace started in step 2. A real
   run recorded 26 spans in one trace: `http.server POST` → `auth.session` →
   `Auth.getSession` → `agent.run` → `ThreadService.get` →
   `MessageService.append` → `MessageService.list` →
   `ContextAssembler.assemble` → `AgentRunner.turn` → `ModelProvider.stream`
   → `ApiKeyProvider.stream` → `LanguageModel.streamText` → `http.client
POST` (the Anthropic request) → `MessageService.replaceParts` →
   `ThreadService.touch`, each with its `sql.execute` children; a tool round
   adds `TaskService.create` and `sql.transaction`. The server exports to the
   OTel collector, which fans out to Jaeger (http://localhost:16686, query
   API `/api/v3/traces`) and, when the `langfuse` profile is up, to Langfuse
   (ADR 0005, 0010). The Playwright flow asserts this shape.

## Auth

Single user, passkeys only. `bun run db:seed` inserts the owner row in Better
Auth's `user` table. `bun run auth:link` asks Better Auth for a magic link
and prints it; the server never prints links. Opening it creates a session
and lands on `/passkeys`, where the device registers a passkey. `/login`
offers passkey sign-in with WebAuthn conditional UI. Runtime user creation
is blocked (`disableSignUp` plus a database hook). Everything auth lives
under `/api/auth`; all other API groups except `health` require a session
(ADR 0003, 0004, 0015).

The iOS app uses the same session model through Better Auth's `bearer`
plugin (ADR 0018): `bun run auth:link --ios` prints `bloom://sign-in?link=…`;
the app opens the magic link itself, keeps the signed token from the
`set-auth-token` response header in the Keychain and sends
`Authorization: Bearer` on every call. The `Authorization` middleware
forwards the cookie and a Bearer header (nothing else) to `getSession`.

## Jobs

`packages/pipeline` declares `ScheduledJob`s; the server registers each with
pg-boss (queue, cron schedule, worker). The only job is `heartbeat`
(`*/5 * * * *`), which ingests a `system/heartbeat` `Event` with a
minute-bucketed `dedupeKey`, proving the ingest path and idempotency. The
interruption policy exists as a pure, table-tested function
(`interruption-policy.ts`, ADR 0011) but is not yet wired to a pipeline
stage; triage, compose and deliver are not built.

## Observability

Effect's `Otlp.layerJson` exports traces, logs and metrics to
`OTEL_EXPORTER_OTLP_ENDPOINT`. HTTP spans come from the router, SQL spans
from `effect/sql`, model spans (`gen_ai.*`) from `effect/ai`, and every
service method is an `Effect.fn` span. Message content and tokens are never
logged at info; the runner logs a per-run summary (sizes and scope) only.

## Development workflow

```
bun install            bun run infra:up           bun run db:migrate && bun run db:seed
bun run dev            bun run auth:link          bun run check
```

The Vite dev server proxies `/api` to `:3000`. Production serves the static
build from the Bun server at `/`. `bun run check` runs typecheck (tsgo and
svelte-check), Oxlint, Oxfmt and every package's tests; db tests create and
use a `bloom_test` database. The Playwright flow in `apps/web/e2e` is the
executable form of the Phase 0 done-condition.

## Deferred from Phase 0

- ChatGPT-plan and decision providers are stubs behind the shared
  interface; triage routes fail with `ProviderUnavailable` until a model is
  configured (`BLOOM_MODEL_TRIAGE=api_key:claude-haiku-4-5`).
- Pipeline stages beyond ingest; nudge delivery; web push.
- Integration toolkits are not merged into the agent's toolkit yet.
- Routine, Chore, Area, Item, Memory, CheckIn entities; sensitivity tiers
  are typed but no `Memory` data exists to filter.
- iOS client; device tokens.
- The "why did Bloom do this?" debug panel (trace ids are available on
  every run already).
