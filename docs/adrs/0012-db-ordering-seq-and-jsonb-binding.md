# 0012. DB: `seq` identity tiebreaker, JSON-text jsonb binding, row locks

Date: 2026-10-04

Supersedes the ordering and jsonb-binding bullets of ADR 0009.

## Context

ADR 0009 said lists order by `(created_at, id)`. In practice a 50-message
burst within one millisecond came back shuffled: UUIDv7 ids are random
within a millisecond. ADR 0009 also suggested binding jsonb with the pg
codec, but `Schema.Json` allows a bare `null` payload and the codec maps JS
`null` to SQL `NULL`, which violates `NOT NULL`.

## Decision

- Every Bloom table has `seq bigint GENERATED ALWAYS AS IDENTITY`. Lists
  `ORDER BY (created_at, seq)`; indexes follow the same shape. `seq` is not
  part of the domain model; Schema decoding ignores the extra column.
- jsonb columns (`messages.parts`, `events.payload`, `captures.payload`,
  `nudges.actions`) are bound as JSON text (`JSON.stringify` + `::jsonb`),
  so a JSON `null` payload is stored as jsonb `'null'`. `transformJson` is
  off on the client so keys inside jsonb are never case-rewritten.
- Task mutations (`update`, `complete`, `remove`) run in a transaction that
  takes `FOR UPDATE` on the row, so concurrent patches serialize. The audit
  `Event` is written in the same transaction; if it fails, the mutation rolls
  back.
- Better Auth's DDL is inlined verbatim in migration `0001_better_auth`
  (camelCase quoted identifiers, as Better Auth expects). Bloom tables use
  snake_case with camelCase mapping in TypeScript.

## Consequences

- Never hold a TaskService mutation open while awaiting another mutation on
  the same task in the same fiber chain (self-deadlock on the row lock).
- Seeding lowercases `BLOOM_OWNER_EMAIL`; the Better Auth `email` column is
  unique on exact text.
