# 0013. Agent runtime contracts: provider interface, errors, failover, run loop

Date: 2026-10-04

## Context

ADR 0008 fixed the routing table. The implementation in `packages/agent`
had to settle several behaviours ARCHITECTURE.md leaves open.

## Decision

- **One provider interface.** `ProviderShape` (`generate`, `stream`,
  `decide`) is generic over the toolkit type because `Toolkit.WithHandler`
  is invariant. `ApiKeyProvider` is real; `ChatGptPlanProvider` and
  `DecisionProvider` are stubs that fail with `ProviderUnavailable`.
- **One error type.** `ModelError` has four reasons: `ProviderUnavailable`,
  `RateLimited`, `Invalid`, `Upstream`. Its message never contains prompt or
  response content.
- **Failover.** Only `chatgpt_plan` routes fail over, and only on
  `ProviderUnavailable` or `RateLimited`, to `api_key` with the default
  model for that run type. Decision routes do not fail over; set
  `BLOOM_MODEL_TRIAGE=api_key:claude-haiku-4-5` to use a real model for
  triage until the decision provider exists.
- **Limits.** Generate and decide: 90 s timeout, up to 3 attempts, retried
  only for `RateLimited`/`Upstream`, and never when a toolkit is attached.
  Streams are not retried; a stream silent for 60 s fails with `Upstream`.
- **Run loop.** At most 4 model rounds per user turn. Tool handlers run
  inside `effect/ai`'s stream resolution; each round's response parts are
  appended to the prompt. `create_task` uses `failureMode: "error"`, so a
  malformed argument fails the round rather than being fed back to the
  model. Every `tool_call` in the persisted message has a matching
  `tool_result`; an orphaned call gets a synthesized failed result.
- **Stream contract.** On success: `message_start`, then any `tool_call` /
  `tool_result` (plus `tasks_changed` after a successful `create_task`),
  then `text_delta`s, then `message_end` with the persisted message. On a
  model failure the runner persists the partial parts, emits an `error`
  event with calm user-facing text, and then fails the stream with the
  `ModelError`; the HTTP layer ends the SSE response cleanly.
- **Context.** `SOUL.md` is always first. Full scope keeps the last 40
  messages, minimal scope (side threads) the last 6. A per-run log line
  records sizes and scope, never content.
- Run ids are UUIDv4 from `crypto.randomUUID()` for now.

## Consequences

- Swapping a provider is a Layer swap; the runner never sees provider types.
- The web client can treat `error` as terminal and ignore the stream failure.
