#!/usr/bin/env bash
# End-to-end run of the Phase 0 done-condition:
#   passkey login -> message -> streamed model reply -> task appears -> one trace in Jaeger.
#
# Usage (from the repo root):
#   bun run e2e            # resolves op:// secrets with `op run` when `op` is signed in
#   SKIP_OP=1 bun run e2e  # use the environment / .env.local as-is
#
# Requires: docker compose core up (bun run infra:up), a browser for Playwright
# (bunx playwright install chromium), and ANTHROPIC_API_KEY resolvable.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER_PORT="${PORT:-3000}"
WEB_PORT="${WEB_PORT:-5173}"
export WEB_ORIGIN="${WEB_ORIGIN:-http://localhost:${WEB_PORT}}"
LOG_DIR="${LOG_DIR:-/tmp/bloom-e2e}"
mkdir -p "$LOG_DIR"

runner=()
if [[ -z "${SKIP_OP:-}" ]] && command -v op >/dev/null 2>&1 && op whoami >/dev/null 2>&1; then
  runner=(op run --env-file=.env --)
  echo "e2e: resolving secrets with op run"
else
  echo "e2e: running without op (expects ANTHROPIC_API_KEY in the environment or .env.local)"
fi

echo "e2e: checking infrastructure"
pg_isready -q -t 5 -h 127.0.0.1 -p 5432 || { echo "Postgres is not reachable on :5432 (bun run infra:up)"; exit 1; }
for port in "$SERVER_PORT" "$WEB_PORT"; do
  if lsof -ti "tcp:${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port ${port} is already in use; stop that process first"; exit 1
  fi
done
curl -s -m 5 -o /dev/null "http://127.0.0.1:16686/" || { echo "Jaeger is not reachable on :16686 (bun run infra:up)"; exit 1; }

echo "e2e: migrate + seed"
bun run db:migrate >"$LOG_DIR/migrate.log" 2>&1
bun run db:seed >"$LOG_DIR/seed.log" 2>&1

cleanup() {
  echo "e2e: stopping servers"
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
  # `bun run dev` spawns vite as a child node process that outlives its parent;
  # kill whatever still listens on our two ports.
  for port in "$SERVER_PORT" "$WEB_PORT"; do
    lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT

echo "e2e: starting server on :$SERVER_PORT (log: $LOG_DIR/server.log)"
PORT="$SERVER_PORT" "${runner[@]}" bun run apps/server/src/main.ts >"$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!

echo "e2e: starting web on :$WEB_PORT (log: $LOG_DIR/web.log)"
(cd apps/web && bun run dev --port "$WEB_PORT" --strictPort >"$LOG_DIR/web.log" 2>&1) &
WEB_PID=$!

for i in $(seq 1 60); do
  if curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${SERVER_PORT}/api/health" | grep -q 200 \
     && curl -s -m 2 -o /dev/null -w '%{http_code}' "${WEB_ORIGIN}/login" | grep -q 200; then
    echo "e2e: server and web are up after ~$((i*2))s"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo "server exited early; see $LOG_DIR/server.log"; tail -40 "$LOG_DIR/server.log"; exit 1; fi
  sleep 2
done

echo "e2e: running Playwright"
(cd apps/web && bunx playwright test "$@")
