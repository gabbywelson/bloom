/**
 * Entry point for the Better Auth CLI only (schema generation):
 *
 *   bunx auth@1.7.7 generate --config apps/server/src/auth/better-auth.cli.ts -y
 *
 * The generated DDL is not consumed from disk: it is inlined verbatim in the
 * `@bloom/db` migration `0001_better_auth` (ADR 0012), so the `--output` path
 * does not matter. Re-run the generator after upgrading Better Auth or adding
 * a plugin, diff the output against that migration, and add a new migration
 * for any change.
 *
 * Never import this from application code; the server builds its instance in
 * a Layer (`src/auth/service.ts`). Values here are placeholders: `generate`
 * never opens a connection, so the pool is created lazily and never used.
 */
import { Pool } from "pg";
import { createAuth } from "./auth.ts";

export const auth = createAuth({
  database: new Pool({
    connectionString:
      process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/bloom",
  }),
  secret: process.env["BETTER_AUTH_SECRET"] ?? "schema-generation-only-not-a-real-secret-value",
  webOrigin: process.env["BLOOM_WEB_ORIGIN"] ?? "http://localhost:5173",
  rpId: process.env["BLOOM_PASSKEY_RP_ID"] ?? "localhost",
  rpName: process.env["BLOOM_PASSKEY_RP_NAME"] ?? "Bloom",
  onMagicLink: async () => {},
});
