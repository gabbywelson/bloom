# 0010. The Langfuse stack is an opt-in compose profile

Date: 2026-10-04

## Context

The self-hosted Langfuse v4 stack is five containers (web, worker, ClickHouse,
Redis, MinIO). During the scaffolding session the OrbStack VM on the dev
laptop stalled twice while Langfuse was running alongside parallel builds and
tests: the Docker API and the Postgres container stopped answering until
OrbStack was restarted. With only Postgres, the OTel collector and Jaeger
running, the VM stayed healthy under the same load.

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
