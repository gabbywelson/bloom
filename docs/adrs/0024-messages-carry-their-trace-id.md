# 0024. Assistant messages carry the trace id of the run that wrote them

Date: 2026-10-05

## Context

ADR 0005 promised a "why did Bloom do this?" path: from a reply to the trace
of the run that produced it (HTTP request, context assembly, model call, tool
calls, SQL). Every run already happens inside one trace, but nothing tied a
persisted message to it; `Message.runId` is a random UUID that no trace
backend knows.

## Decision

- `Message` gains a nullable `traceId`; migration `0005_message_trace_id`
  adds `messages.trace_id`. `MessageAppend` accepts it.
- `AgentRunner` reads the current span (`agent.run`) when it creates the
  assistant message and stores `span.traceId`. That is the same trace as the
  HTTP request, so the id opens the whole story in Jaeger (and in Langfuse,
  whose trace ids match, ADR 0005). User messages and messages written
  outside a span keep `null`.
- The id travels in `Message.json`, so `message_end` carries it to clients
  with no new event.
- Web: assistant messages with a trace id show a quiet "trace" link next to
  the time, to `VITE_TRACE_URL` + id (default `http://localhost:16686/trace/`;
  empty hides the link). Only 32-hex ids become links.
- iOS: a long-press menu on a message offers "Copy trace ID" (and "Copy
  text"); the phone usually cannot reach the trace backend directly.

## Consequences

- Messages persisted before this change have no trace id and show no link.
- A trace id is not sensitive (it reveals nothing without trace backend
  access) and is safe to keep in the message row.
- The debug panel the brief describes (trace, triggering event, policy
  decision per nudge) can build on the same field once nudges exist.
- Verified: a real reply in the web app showed
  `http://localhost:16686/trace/bb4ab438d7b2bf6c0f99391ae14a0723`, and Jaeger
  returned that trace with 26 spans including `http.server POST`,
  `agent.run`, `ModelProvider.stream` and `LanguageModel.streamText`.
