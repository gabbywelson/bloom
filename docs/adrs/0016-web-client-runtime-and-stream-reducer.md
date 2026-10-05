# 0016. Web client: one ManagedRuntime, a pure stream reducer, UI actions as replies

Date: 2026-10-04

## Context

The web app is a Svelte 5 SPA. The API client is an Effect value (ADR 0007)
and the chat endpoint returns an Effect `Stream`, but Svelte components work
with Promises and `$state`.

## Decision

- `src/lib/api.ts` builds a single `ManagedRuntime` from `BloomClient.layer()`
  and exposes Promise helpers (`loadMainThread`, `loadMessages`,
  `loadTasks`, `completeTask`, `sendMessage`). Plain calls get a 20 s timeout.
  An `Unauthorized` error refreshes the session store and navigates to
  `/login`.
- `sendMessage` runs the SSE `Stream` with `Stream.runForEach` and hands
  every `ChatStreamEvent` to the caller. Per ADR 0013 the server emits an
  `error` event and then fails the stream; the client treats that failure
  as expected and surfaces only the event's text.
- `src/lib/chat.ts` is a pure reducer `applyEvent(messages, event, now)`
  that implements the ADR 0013 event sequence; it is unit-tested without a
  browser.
- Generative UI: `UiComponentPart.svelte` is an exhaustive `{#if}` over the
  domain `kind`s with a `Fallback`. Choices made in `option_picker`,
  `confirm` and `snooze_picker` are sent back to Bloom as the user's reply
  text; nothing consequential executes client-side. `task_card` "Done" calls
  the tasks API directly because completing a task is the user's own action.
- Stable `data-testid` attributes are part of the UI contract for the
  Playwright flow in `apps/web/e2e`.

## Consequences

- Components never see Effect types; the boundary is `api.ts`.
- A structured "UI action" endpoint can replace the text round-trip later
  without touching components.
