import { BunServices } from "@effect/platform-bun";
import { PgMigrator } from "@effect/sql-pg";
import { Layer } from "effect";
import { migrations } from "../migrations/index.ts";

/**
 * Runs pending migrations while the layer is built. No `schemaDirectory`, so
 * `pg_dump` is never invoked; the Bun platform services the migrator type
 * requires are provided here so callers only need `PgLive`.
 */
export const MigratorLive = PgMigrator.layer({
  loader: PgMigrator.fromRecord(migrations),
}).pipe(Layer.provide(BunServices.layer));
