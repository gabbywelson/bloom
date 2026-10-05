# 0014. API input schemas are the encoded side of the domain create variants

Date: 2026-10-04

## Context

`Task.jsonCreate` decodes a minimal client payload and applies defaults, but
its TypeScript `Type` has every key required, so a derived client would have
forced the web app to send fully populated objects.

## Decision

- Request payloads for creates are `Schema.toEncoded(Entity.jsonCreate)`
  applied to the whole struct (`TaskCreateInput`, `ThreadCreateInput`): only
  the truly required keys are required, timestamps are ISO strings, and the
  server decodes with `decodePayload(Entity.jsonCreate)` before calling the
  domain service. A residual decode failure is a 400.
- `POST /api/threads` only accepts `kind: "side" | "quest"`; the single main
  thread is never created by clients. `GET /api/threads/main` returns it
  (creating it if missing) so the web app does not list-and-filter.
- Creates return 200 with the entity, not 201.
- Response types stay the `json` variants with `DateTime.Utc` values.

## Consequences

- `client.tasks.create({ payload: { title } })` compiles and works.
- Effect 4 gotcha recorded: applying `Schema.toEncoded` per field keeps the
  original optionality; apply it to the whole struct.
