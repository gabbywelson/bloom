# 0010. The Langfuse stack is an opt-in compose profile

Date: 2026-10-04

## Context

The self-hosted Langfuse v4 stack is five containers (web, worker, ClickHouse,
Redis, MinIO). During the scaffolding session the OrbStack VM on the dev
laptop stalled three times: the Docker API and the Postgres container stopped
answering until OrbStack was stopped and started again (`orb stop`,
`orb start`). The first two stalls happened with Langfuse running under heavy
host load; the third happened at low load with Langfuse off, while tests were
opening and closing many Postgres connections. So the stall is an OrbStack
issue, not a Langfuse one, and the profile below is about keeping the default
stack light rather than a fix. If stalls continue, run Postgres natively
(Homebrew `postgresql@17`) for development and keep compose for the home
server.

Jaeger already shows every trace, including the `gen_ai.*` model spans, so
Langfuse is a richer view of the same data rather than the only one.

## Decision

- `docker compose up -d` (`bun run infra:up`) starts the core: Postgres, OTel
  collector, Jaeger.
- Langfuse and its dependencies carry `profiles: ["langfuse"]`;
  `bun run infra:up:langfuse` adds them. `infra:down` / `infra:reset` include
  the profile so nothing is left behind.
- The collector keeps its Langfuse exporter configured. When Langfuse is down
  the exporter retries for two minutes and then drops those batches; Jaeger is
  unaffected.

## Consequences

- Day-to-day development needs three containers, not eight.
- Model-call traces land in Langfuse only when the profile is up. The server
  does not know or care.
- On the home Linux server, where there is no VM in the way, run with the
  profile permanently.
