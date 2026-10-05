# 0018. iOS auth: the app opens the CLI magic link itself and keeps a bearer token

Date: 2026-10-05

## Context

The web signs in with passkeys bound to its origin, after a CLI-issued magic
link creates the first session (ADR 0003). The iOS app cannot do either yet:

- Passkeys on iOS need an associated domain served over HTTPS
  (`apple-app-site-association`), and Bloom has no public HTTPS origin; it
  lives on localhost and Tailscale.
- Cookies are a poor fit for a native client and its extensions (share
  sheet, widgets), which need a credential they can read from the Keychain.

The single-user invariant stays: no sign-up, runtime user creation blocked.

Options considered:

1. Better Auth's `bearer` plugin. Any response that creates a session also
   returns the signed session token in a `set-auth-token` header; requests
   with `Authorization: Bearer <token>` are treated as that session.
2. A pairing-code endpoint (CLI prints a short code, the app exchanges it).
   More code on our side, and a new credential type to secure.
3. Passkeys now, with a self-signed or tunnel-provided HTTPS domain. Not
   possible without a paid developer account and a real domain tonight.

## Decision

Option 1, bootstrapped with the existing magic link.

- **Server.** `createAuth` adds `bearer({ requireSignature: true })`: only the
  exact signed token from `set-auth-token` is accepted, never the raw session
  id. The `Authorization` middleware now forwards a `Bearer` authorization
  header to Better Auth alongside the cookie; other schemes are dropped. The
  web is unaffected and keeps its cookie.
- **CLI.** `bun run auth:link --ios [--server <origin>]` prints
  `bloom://sign-in?link=<the magic link>`. `--server` rewrites the link's
  origin to whatever the phone can reach (`http://localhost:3000` in the
  simulator, the Tailscale name on a device). Without `--ios` the command is
  unchanged.
- **App.** The app registers the `bloom` URL scheme. Opening the deep link, or
  pasting the raw magic link on the sign-in screen, makes the app `GET` the
  verify URL itself with redirects disabled and read `set-auth-token`. It then
  calls `GET /api/me` with the token, stores the token in the Keychain
  (`AfterFirstUnlockThisDeviceOnly`, never synced) and the server origin and
  user in `UserDefaults`, and sends `Authorization: Bearer` on every API call.
  The link's origin is the server; the sign-in screen can override it.
- **Sign-out** posts to `/api/auth/sign-out` with the bearer token (which
  revokes the session server-side) and forgets the token locally even when
  offline. A 401 from any call signs the app out.
- **Hand-written calls.** The verify `GET` and the sign-out `POST` are written
  by hand: `/api/auth/*` belongs to Better Auth and is not in the HttpApi
  contract (the exception ADR 0007 already makes for the web).
- **Transport security.** ATS allows plain HTTP only to the local network
  (`NSAllowsLocalNetworking`, which covers the simulator's localhost) and to
  `*.ts.net` names, whose traffic WireGuard already encrypts. Anything else
  must be HTTPS.

## Consequences

- One trust boundary for every device: shell access to the server issues the
  link. A link is single-use and expires after 15 minutes; tests prove
  replay, tampered and unsigned tokens fail, and that sign-out revokes.
- Sessions follow Better Auth's defaults (7 days, extended on use), so a phone
  that is used weekly stays signed in. One unused for longer needs a new link.
- The token can be shared with app extensions through a Keychain access group
  when those exist; the store already takes an access group and a defaults
  suite.
- iOS passkeys become possible once Bloom has an HTTPS domain; the bearer
  token would then be issued after a passkey sign-in instead of a link.
- `simctl openurl` asks "Open in Bloom?" before delivering the link; tap Open.
