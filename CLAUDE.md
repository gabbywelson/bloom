# Bloom — agent instructions

Bloom is a single-user personal agent app. Read docs/VISION.md and
docs/ARCHITECTURE.md before any non-trivial change.

## Working style
- Work autonomously. Make reasonable decisions; record non-obvious ones
  as ADRs in docs/decisions/NNNN-title.md (context, decision, consequences).
- After each task, update docs/ARCHITECTURE.md if module boundaries,
  data flow, or the data model changed.
- Prefer small, reviewable commits with descriptive messages.
- Never add a dependency without a one-line justification in the commit.

## Effect conventions
- Use Effect for all server code. Consult the official Effect docs
  (LLM-friendly version) before writing unfamiliar APIs; do not guess.
- Services are Context.Tag + Layer. No module-level singletons.
- Errors are tagged (Data.TaggedError). Never throw. Never use `any`.
- Domain types live in packages/domain as Effect Schema; derive TS types.
- External calls get explicit timeouts and Schedule-based retries.
- Every service method gets a span (Effect.withSpan).

## Svelte conventions
- Svelte 5 runes only ($state, $derived, $effect, $props). No legacy
  `export let` or stores for component state. Use the Svelte MCP server
  / llms docs to check syntax.
- The API client is generated from packages/api. Never hand-write fetches.

## Boundaries
- apps/* may import packages/*. Never the reverse.
- integrations/* expose tools and emit Events via interfaces in domain/.
- Agent tools mutate state only through domain services.
- Anything that sends email, spends money, or launches code agents must
  return a confirmation UI component, never execute directly.

## Testing
- Unit tests for domain services and the interruption policy (bun test).
- Model calls are behind ModelProvider; tests use a fake Layer.
- Integration tests hit a real local Postgres via docker compose.

## Privacy
- Respect sensitivity tiers in packages/agent context assembly.
- Never log message content or tokens at info level.