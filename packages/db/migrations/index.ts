import type { Effect } from "effect";
import type { SqlClient } from "effect/sql";
import betterAuth from "./0001_better_auth.ts";
import bloomCore from "./0002_bloom_core.ts";

/**
 * Every migration, keyed `<id>_<name>` for `PgMigrator.fromRecord`. Ids run in
 * numeric order; append new entries, never edit applied ones.
 */
export const migrations: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>> = {
  "0001_better_auth": betterAuth,
  "0002_bloom_core": bloomCore,
};
