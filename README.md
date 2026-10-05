# Bloom

A personal agent for one person. Tasks, chores, self-care and capture, with a
proactive partner rather than a chatbot. Read `docs/VISION.md` for the why and
`docs/ARCHITECTURE.md` for the how; decisions live in `docs/adrs/`.

## Quickstart (local)

Requirements: Bun 1.3+, Docker (OrbStack or Docker Desktop), an Anthropic API
key, and optionally the 1Password CLI (`op`).

```sh
bun install                 # installs every workspace, patches tsgo, installs git hooks
cp .env.example .env        # then edit: BLOOM_OWNER_EMAIL, BETTER_AUTH_SECRET, ANTHROPIC_API_KEY
bun run infra:up            # Postgres, OTel collector, Jaeger (add :langfuse for Langfuse)
bun run db:migrate          # creates the schema (Better Auth + Bloom tables)
bun run db:seed             # creates the single user and the main thread
bun run dev                 # server on :3000, web on :5173 (proxies /api to the server)
```

If `ANTHROPIC_API_KEY` in `.env` is a 1Password reference (`op://...`), start
with `bun run dev:op` instead; it resolves secrets at launch without writing
them to disk.

First sign-in on a device:

```sh
bun run auth:link           # prints a one-time sign-in link (15 minutes)
```

Open the link, add a passkey on `/passkeys`, and from then on sign in with the
passkey at `/login`. There is no sign-up flow by design (ADR 0003).

## Where things are

| Path                    | What                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `apps/server`           | The one Bun + Effect process: HTTP API, auth, agent runtime, jobs, telemetry |
| `apps/web`              | SvelteKit 3 / Svelte 5 PWA                                                   |
| `packages/domain`       | Effect Schema entities, ids, events, UI component parts, service interfaces  |
| `packages/api`          | The HttpApi contract; typed client; `openapi.json`                           |
| `packages/db`           | Migrations, repositories, DB-backed domain services, seed                    |
| `packages/agent`        | Model providers, routing, context assembly, tools, run loop                  |
| `packages/pipeline`     | Scheduled jobs, interruption policy                                          |
| `packages/integrations` | One module per external source (empty registry today)                        |
| `docs/SOUL.md`          | Bloom's persona, loaded at runtime                                           |
| `repos/`                | Vendored reference sources for coding agents (read-only)                     |

## Everyday commands

```sh
bun run check               # typecheck + lint + format check + all tests
bun run test                # all package tests (db tests need Postgres)
bun run openapi             # regenerate packages/api/openapi.json
bun run infra:up:langfuse   # add the Langfuse stack (heavy; ADR 0010)
```

Traces: Jaeger at http://localhost:16686, Langfuse at http://localhost:3200
(when running). API docs: http://localhost:3000/api/docs.
