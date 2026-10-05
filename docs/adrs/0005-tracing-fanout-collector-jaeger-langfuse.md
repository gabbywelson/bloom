# 0005. One OTLP export, fanned out by the collector to Jaeger and Langfuse

Date: 2026-10-04

## Context

The brief asks for "OpenTelemetry export to the local collector; Langfuse
for model calls" and for one request to be visible as one trace. Langfuse
accepts OTLP/HTTP directly and maps `gen_ai.*` span attributes (which
Effect's AI providers emit) onto generations. A general trace backend is
still needed to see HTTP, SQL and job spans with full fidelity.

## Decision

- The server exports every span, log and metric to the OTel collector
  (`OTEL_EXPORTER_OTLP_ENDPOINT`, default `http://localhost:4318`) using
  Effect's `Otlp` layer. Nothing talks to Jaeger or Langfuse directly.
- The collector fans traces out to Jaeger (everything) and to Langfuse
  (everything as well, for now). Langfuse shows the model call as a
  generation inside the same trace as the HTTP request and DB work.
- Langfuse runs self-hosted (v4 stack: web, worker, ClickHouse, Redis,
  MinIO) in the same compose file, seeded headlessly with dev API keys.

## Consequences

- Trace IDs match across Jaeger and Langfuse, so a "why did Bloom do this?"
  panel can deep-link to either.
- The compose stack is heavy (7 containers for Langfuse alone). Acceptable
  for a dev machine; the home server runs the same file.
- If non-model spans become noise in Langfuse, add a `filter` processor to
  the Langfuse pipeline keeping only spans with `gen_ai.*` attributes and
  their ancestors. Not done yet.
