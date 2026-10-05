# 0009. One Model.Class per entity; Date in DB variants, ISO strings in JSON; jsonb as parsed JSON

Date: 2026-10-04

## Context

Entities are declared once in `packages/domain` with `Model.Class` and used in
three places with different wire shapes: Postgres rows (via `@effect/sql-pg`),
JSON over the HttpApi, and in-process TypeScript. `@effect/sql-pg` decodes
`timestamptz` columns to JS `Date` and `jsonb` columns to parsed JSON (verified
in `repos/effect/packages/sql/pg/src/PgTypes.ts`). Clients, and the future
Swift app, want ISO-8601 strings.

## Decision

- `packages/domain/src/fields.ts` owns the reusable field helpers. Timestamps
  are `DateTime.Utc` in TypeScript, `Date` in the `select`/`insert`/`update`
  variants and ISO strings in `json`/`jsonCreate`/`jsonUpdate`.
  Server-managed timestamps (`createdAt`, `updatedAt`, `completedAt`,
  `lastMessageAt`, `sentAt`, `outcomeAt`) are absent from the JSON create and
  update variants.
- `jsonUpdate` is always a true partial patch (every key optional);
  `jsonCreate` decodes a minimal client payload and applies defaults
  (`status: "inbox"`, nullable fields `null`). Write-once fields use
  `Immutable`, mutable required fields use `Patchable`.
- JSON-shaped columns (`Message.parts`, `Event.payload`, `Capture.payload`,
  `Nudge.actions`) are declared with their real schema in every variant and
  stored as `jsonb`. Inserts bind them as JSON (`sql.json(...)`), never as a
  Postgres array.
- Ordering is never derived from UUIDv7 ids (Effect's generator has no
  monotonic counter within a millisecond). Lists order by `created_at` plus a
  tiebreaker (`id`, or a sequence), and the in-memory layers keep insertion
  order.
- `ThreadService.list` and `ThreadService.ensureMain` are Effect values, not
  zero-argument functions, to satisfy the Effect lint rule `lazy-effect`.
- `Thread.contextScope` has no schema default. Omitting it on create is
  distinguishable from choosing `"full"`, and `ThreadService.create` applies
  `defaultContextScope(kind)` (side threads get `"minimal"`, main and quest
  get `"full"`). The db layer must apply the same rule.
- `Nudge` carries both `body` (the user-facing text the Compose stage writes)
  and `reasoning` (the internal "why" for the debug panel), plus an optional
  `messageId` when a nudge is delivered as an inbox message. `actions` is a
  non-empty array: a nudge with nothing to tap is not a nudge.
- `Event` rows are append-only: the update variants contain only `dedupeKey`.

## Consequences

- The HttpApi uses the `json*` variants and never sees a `Date`.
- Repositories use `Entity.insert.makeEffect(...)` so ids and timestamps come
  from the Effect clock (tests can use `TestClock`).
- `effecttsgo/unstable-api-usage` is disabled repo-wide: Effect 4 marks most of
  `effect/schema/Model`, `effect/http-api`, `effect/sql` and `effect/ai` as
  unstable, and the warning carries no information for us.
