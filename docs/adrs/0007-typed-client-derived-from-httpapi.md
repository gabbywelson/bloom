# 0007. The web client is derived from the HttpApi, and OpenAPI is emitted

Date: 2026-10-04

## Context

CLAUDE.md forbids hand-written fetches; the client must be generated from
`packages/api`. Two ways exist: generate TypeScript from `openapi.json`
with a codegen tool, or derive the client in-process from the `HttpApi`
value with `HttpApiClient.make`.

## Decision

- The web app uses `HttpApiClient.make(BloomApi)` over `FetchHttpClient`
  with no base URL: `BloomApi` already carries the `/api` prefix and the
  browser is same-origin (ADR 0004), so relative URLs resolve correctly. It is type-checked against the same definition
  the server implements, including the SSE stream endpoint, which the
  client exposes as an Effect `Stream`.
- `bun run openapi` writes `packages/api/openapi.json` from
  `OpenApi.fromApi(BloomApi)`; this is the contract for the future Swift
  client and for the `/api/docs` page. The file is committed and regenerated
  whenever the API changes.

## Consequences

- No codegen step for the web; renames are compile errors in both apps.
- The web bundle includes Effect (tree-shaken). Acceptable for a PWA used
  by one person; revisit if bundle size ever matters.
- Better Auth has its own client (`better-auth/svelte`); it is the one
  exception to "client from packages/api" because auth routes are not part
  of the HttpApi.
