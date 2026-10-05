import { Device } from "@bloom/domain";
import { Effect, Schema } from "effect";
import { SqlClient, SqlModel, SqlSchema } from "effect/sql";

/** Internal repository over the `devices` table. Lists order by (created_at, seq). */
export const makeDeviceRepo = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const repo = yield* SqlModel.makeRepository(Device, {
    tableName: "devices",
    spanPrefix: "DeviceRepo",
    idColumn: "id",
  });

  /**
   * Insert, or update the existing row with the same push token. Atomic, so
   * two launches registering at once still leave one row.
   */
  const upsert = SqlSchema.findOne({
    Request: Device.insert,
    Result: Device,
    execute: (row) =>
      sql`INSERT INTO devices ${sql.insert(row)}
          ON CONFLICT (push_token) DO UPDATE SET
            push_environment = EXCLUDED.push_environment,
            name = EXCLUDED.name,
            app_version = EXCLUDED.app_version,
            updated_at = EXCLUDED.updated_at
          RETURNING *`,
  });

  const list = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Device,
    execute: () => sql`SELECT * FROM devices ORDER BY created_at, seq`,
  });

  return { findById: repo.findById, delete: repo.delete, upsert, list } as const;
});
