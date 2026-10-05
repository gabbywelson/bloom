# 0008. Model routing defaults

Date: 2026-10-04

## Context

Routing is a static table keyed by run type (`conversation`, `triage`,
`plan`, `summarize`, `side_thread`), not by model. Only the API-key
provider is implemented in this phase; the ChatGPT-plan and decision
providers are stubs behind the same interface.

## Decision

Defaults (overridable via `BLOOM_MODEL_*` env vars):

| Run type     | Provider | Model                             |
| ------------ | -------- | --------------------------------- |
| conversation | api_key  | claude-opus-5-5                   |
| side_thread  | api_key  | claude-opus-5-5                   |
| plan         | api_key  | claude-opus-5-5                   |
| summarize    | api_key  | claude-haiku-4-5                  |
| triage       | decision | claude-haiku-4-5 (stub until Jev) |

- `claude-opus-5-5` is Anthropic's current default-tier model; thinking is
  always on, so no thinking parameters are sent. Effort stays at the API
  default.
- Background runs never route to the plan provider, so they can't drain it.

## Consequences

- Conversation quality first; cost is secondary for a single user.
- Swapping a row is a config change, not a code change.
