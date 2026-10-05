# 0004. Web app and API share one browser origin

Date: 2026-10-04

## Context

Passkeys (WebAuthn) bind to an origin, Better Auth uses cookies, and
cross-origin cookies are a swamp (SameSite, CORS with credentials,
third-party cookie blocking in Safari).

## Decision

The browser only ever talks to one origin.

- Dev: SvelteKit's Vite server (`:5173`) proxies `/api/*` to the Bun
  server (`:3000`). `BETTER_AUTH_URL` / `BLOOM_WEB_ORIGIN` is the web origin.
- Prod: the Bun server serves the static SvelteKit build (adapter-static,
  SPA fallback) from `/` and the API from `/api/*`. Same origin, no proxy.
- All API routes live under `/api`; Better Auth under `/api/auth`.

## Consequences

- No CORS configuration is needed for the web app. CORS stays off.
- The passkey relying-party ID is just the hostname (`localhost` in dev).
- The iOS client later uses bearer tokens, not cookies, so it is unaffected.
