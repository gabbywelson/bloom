import { Event } from "@bloom/domain";
import { Effect, Schema } from "effect";
import { SqlClient, SqlModel, SqlSchema } from "effect/sql";
import { jsonb } from "./jsonb.ts";

/**
 * Internal repository over the append-only `events` table. `payload` is jsonb
 * and bound as JSON text. `insertIfNew` relies on the partial unique
 * index on `dedupe_key` so duplicates are detected atomically.
 */
export const makeEventRepo = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const repo = yield* SqlModel.makeRepository(Event, {
    tableName: "events",
    spanPrefix: "EventRepo",
    idColumn: "id",
  });

  /** Zero rows back means another event already carries this dedupe_key. */
  const insertIfNew = SqlSchema.findAll({
    Request: Event.insert,
    Result: Event,
    execute: (row) =>
      sql`INSERT INTO events ${sql.insert({ ...row, payload: jsonb(row.payload) })}
          ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING *`,
  });

  const list = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Event,
    execute: () => sql`SELECT * FROM events ORDER BY created_at, seq`,
  });

  return { findById: repo.findById, insertIfNew, list } as const;
});
