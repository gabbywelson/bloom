# Web end-to-end tests

`bloom.spec.ts` proves the done-condition against a real stack: magic-link
bootstrap, passkey registration and sign-in (via a CDP virtual authenticator,
so no OS prompt), a chat turn that creates a task, a follow-up question, and a
Jaeger check that the request and the agent run share one trace.

Playwright does **not** start any servers (`playwright.config.ts` has no
`webServer`). Bring the stack up first, from the repo root:

```sh
# 1. Infra: Postgres, OTel collector, Jaeger (Langfuse is optional)
bun run infra:up

# 2. Database: schema and the single owner user + main thread
bun run db:migrate
bun run db:seed

# 3. Server (port 3000) and web dev server (port 5173), in one of two ways:
bun run dev:op            # resolves ANTHROPIC_API_KEY (op://) through 1Password
# or, with ANTHROPIC_API_KEY already set in the environment / .env:
bun run dev

# 4. The browser, once
bunx playwright install chromium

# 5. The suite
bun run --filter @bloom/web test:e2e
```

Environment knobs (all optional):

| Variable         | Default                  | Meaning                                |
| ---------------- | ------------------------ | -------------------------------------- |
| `WEB_ORIGIN`     | `http://localhost:5173`  | Playwright `baseURL`                   |
| `JAEGER_URL`     | `http://localhost:16686` | Jaeger v3 query API (`/api/v3/traces`) |
| `JAEGER_SERVICE` | `bloom-server`           | `service.name` the server exports      |

Notes:

- The spec shells out to `bun run auth:link` in the repo root to obtain the
  magic link, so it needs the same `.env` the server uses (Bun loads `.env`
  from the current working directory only).
- The passkey is registered inside the browser context of the run; nothing is
  left on the machine. Postgres keeps the passkey row, which is harmless: the
  next run registers another one (the spec asserts the count grew by one, not
  that it is one, so re-runs against the same database pass).
- The trace check only accepts traces that started after this run's first
  chat turn, so traces left by earlier runs cannot make it pass. Jaeger
  2.x serves only the v3 query API; the legacy `/api/traces` endpoint is gone.
- The model call must succeed for the chat steps, so a resolvable
  `ANTHROPIC_API_KEY` is required. Timeouts are generous (90 s per reply).
- To watch: `bun run --filter @bloom/web test:e2e -- --headed`, or
  `--trace on` and `bunx playwright show-trace`.
