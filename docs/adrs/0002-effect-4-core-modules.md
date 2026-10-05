# 0002. Build on Effect 4 core modules (http-api, sql, ai, observability)

Date: 2026-10-04

## Context

The vendored reference in `repos/effect` is Effect 4. In Effect 4 the former
`@effect/platform` HttpApi, `@effect/sql`, `@effect/ai` and the OTLP
exporters live inside the `effect` package (`effect/http-api`, `effect/sql`,
`effect/ai`, `effect/observability`). Only runtime adapters remain separate:
`@effect/platform-bun`, `@effect/sql-pg`, `@effect/ai-anthropic`,
`@effect/ai-openai`.

ARCHITECTURE.md left "Drizzle or Effect SQL" open, and the Effect spike was
meant to decide whether Effect fits at all.

## Decision

- Use Effect 4 throughout the server. The spike is this skeleton.
- Database access through `effect/sql` + `@effect/sql-pg`. Domain entities
  are defined once with `Model.Class` (from `effect/schema`), which derives
  the `select`/`insert`/`update` variants for the repositories and the
  `json`/`jsonCreate`/`jsonUpdate` variants for the API. No Drizzle.
- Model access through `effect/ai` (`LanguageModel`, `Toolkit`, `Prompt`)
  with provider layers from `@effect/ai-anthropic` / `@effect/ai-openai`,
  wrapped by our own `ModelProvider` service so providers stay swappable.
  The official Anthropic SDK is not used directly; Effect's provider emits
  the same `gen_ai.*` span attributes Langfuse understands.
- Telemetry through `effect/observability` `Otlp` layers (no OpenTelemetry
  SDK dependency in the server).
- Tests use `bun test` (as CLAUDE.md requires) with plain `Effect.runPromise`
  helpers rather than `@effect/vitest`, which needs vitest.

## Consequences

- One `Model.Class` per entity is the single source of truth for DB and
  JSON shapes; variants are derived, not duplicated.
- Everything is typed end to end: handlers, client, OpenAPI.
- Effect 4 APIs are marked `@stability unstable` in places; we pin minor
  versions and read `repos/effect` before using unfamiliar APIs.
