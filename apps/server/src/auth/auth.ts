/**
 * Better Auth configuration for Bloom.
 *
 * Single user, passkeys only. The first session is created from a magic link
 * issued by the CLI (`bun run auth:link`), never from a sign-up flow. See
 * docs/adrs/0003-auth-bootstrap-magic-link-then-passkeys.md.
 *
 * This module builds the Better Auth instance from explicit options so the
 * server can construct it inside an Effect Layer. It has no module-level
 * singleton; `better-auth.cli.ts` is the only place that instantiates it at
 * import time, and only for schema generation.
 */
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import type { Pool } from "pg";

export interface AuthOptions {
  /**
   * Postgres pool. Better Auth owns the user/session/account/verification/passkey
   * tables. The caller owns the pool's lifecycle (the server releases it with
   * its Layer; the CLI config never connects).
   */
  readonly database: Pool;
  /** 32+ random bytes, base64. Used for signing cookies and hashing tokens. */
  readonly secret: string;
  /** The browser origin, e.g. http://localhost:5173. Cookies and passkeys bind to it. */
  readonly webOrigin: string;
  /** WebAuthn relying-party id, usually the hostname of `webOrigin`. */
  readonly rpId: string;
  readonly rpName: string;
  /** Called when a magic link is issued. Bloom prints it to the terminal instead of emailing it. */
  readonly onMagicLink: (link: { readonly email: string; readonly url: string }) => Promise<void>;
}

export const AUTH_BASE_PATH = "/api/auth";

/** Magic links stay valid for 15 minutes: long enough to copy from a terminal, short enough to not matter if leaked. */
export const MAGIC_LINK_EXPIRES_IN_SECONDS = 15 * 60;

export const createAuth = (options: AuthOptions) =>
  betterAuth({
    appName: "Bloom",
    database: options.database,
    secret: options.secret,
    baseURL: options.webOrigin,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: [options.webOrigin],
    emailAndPassword: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          // Bloom has exactly one user, created by `bun run db:seed`. Refuse
          // any runtime user creation regardless of which plugin asks.
          before: async () => false,
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
        disableSignUp: true,
        sendMagicLink: async ({ email, url }) => options.onMagicLink({ email, url }),
      }),
      passkey({
        rpID: options.rpId,
        rpName: options.rpName,
        origin: options.webOrigin,
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "preferred",
        },
      }),
    ],
  });

export type Auth = ReturnType<typeof createAuth>;
