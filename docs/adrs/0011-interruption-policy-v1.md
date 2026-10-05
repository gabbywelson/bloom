# 0011. Interruption policy v1: rule precedence and inputs

Date: 2026-10-04

## Context

ARCHITECTURE.md lists the v1 rules (daily budget, quiet hours and focus
windows, batching, back-off, energy awareness) but not how they combine. The
policy is a pure function in `packages/pipeline/src/interruption-policy.ts`
so it can be table-tested and tuned without touching the pipeline.

## Decision

`decide(candidate, state)` returns `send`, `batch` or `drop` with a reason,
evaluating rules in this order (first match wins):

1. **Back-off drop**: net dismissals (`dismissed - actedOn`) of this kind
   ≥ 3 → drop, for every kind including time-sensitive.
2. **Focus or therapy window** → batch, every kind.
3. **Quiet hours** → batch, every kind. Quiet hours are a half-open
   `[start, end)` window of local hours that may wrap midnight; the owner's
   IANA zone comes from `BLOOM_TIME_ZONE` (UTC when omitted).
4. **Time-sensitive** → send, exempt from the daily budget, but capped by a
   separate `timeSensitiveCap` (default 10 per day).
5. **Info** → batch (digest material, never a push).
6. **Gradual back-off**: net dismissals 1–2 → batch for chores and
   self-care.
7. **Low energy**: chores → batch; self-care → send even over budget.
8. **Daily budget** (non-time-sensitive sends) reached → batch.
9. Otherwise send.

The decision `reason` string is stored in `Nudge.reasoning` for the debug
panel.

## Consequences

- The Policy stage must supply counts the schema does not yet carry per kind
  (`dismissedRecently`, `actedOnRecently`, `timeSensitiveSentToday`). A
  `kind` column on `Nudge` is the obvious next step; not done yet.
- Reason strings are human text, not identifiers. Do not pattern-match them.
