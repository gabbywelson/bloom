/**
 * Better Auth browser client.
 *
 * The server mounts Better Auth at `/api/auth` on the same origin as this app
 * (docs/adrs/0004-single-origin-web-and-api.md), so no absolute `baseURL` is
 * given: the client falls back to `window.location.origin` and only
 * `basePath` is set.
 */
import { passkeyClient } from "@better-auth/passkey/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/svelte";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [passkeyClient(), magicLinkClient()],
});

export type AuthClient = typeof authClient;
export type Session = AuthClient["$Infer"]["Session"];
export type Passkey = AuthClient["$Infer"]["Passkey"];
