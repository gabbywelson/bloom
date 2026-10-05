/**
 * Entry point for the Better Auth CLI only (schema generation):
 *
 *   bunx auth@1.7.7 generate --config apps/server/src/auth/better-auth.cli.ts \
 *     --output packages/db/migrations/better-auth.sql -y
 *
 * Never import this from application code; the server builds its instance in
 * a Layer. Values here are placeholders: `generate` never opens a connection.
 */
import { createAuth } from "./auth.ts";

export const auth = createAuth({
  databaseUrl: process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/bloom",
  secret: process.env["BETTER_AUTH_SECRET"] ?? "schema-generation-only-not-a-real-secret-value",
  webOrigin: process.env["BLOOM_WEB_ORIGIN"] ?? "http://localhost:5173",
  rpId: process.env["BLOOM_PASSKEY_RP_ID"] ?? "localhost",
  rpName: process.env["BLOOM_PASSKEY_RP_NAME"] ?? "Bloom",
  onMagicLink: async () => {},
});
