import { PgClient } from "@effect/sql-pg";
import { Config, type Layer, type Redacted, String } from "effect";
import type { SqlClient, SqlError } from "effect/sql";

/**
 * Columns are snake_case in SQL and camelCase in TypeScript: the client
 * rewrites identifiers on the way in and result keys on the way out.
 * `transformJson: false` keeps jsonb payloads (message parts, event payloads)
 * byte-for-byte intact; only top-level column names are transformed.
 */
const transforms = {
  transformQueryNames: String.camelToSnake,
  transformResultNames: String.snakeToCamel,
  transformJson: false,
  applicationName: "bloom",
} as const;

/** Postgres client configured from `DATABASE_URL`. Provides `PgClient` and `SqlClient`. */
export const PgLive = PgClient.layerConfig({
  url: Config.Redacted("DATABASE_URL"),
  transformQueryNames: Config.succeed(transforms.transformQueryNames),
  transformResultNames: Config.succeed(transforms.transformResultNames),
  transformJson: Config.succeed(transforms.transformJson),
  applicationName: Config.succeed(transforms.applicationName),
});

/** Postgres client for an explicit connection URL (tests, one-off scripts). */
export const makePgLayer = (
  url: Redacted.Redacted,
): Layer.Layer<PgClient.PgClient | SqlClient.SqlClient, SqlError.SqlError> =>
  PgClient.layer({ url, ...transforms });
