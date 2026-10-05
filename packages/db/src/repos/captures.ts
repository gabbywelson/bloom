import { Capture } from "@bloom/domain";
import { Effect, Schema } from "effect";
import { SqlClient, SqlModel, SqlSchema } from "effect/sql";
import { jsonb } from "./jsonb.ts";

/** Internal repository over the `captures` table; `payload` is jsonb. */
export const makeCaptureRepo = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const repo = yield* SqlModel.makeRepository(Capture, {
    tableName: "captures",
    spanPrefix: "CaptureRepo",
    idColumn: "id",
  });

  const insert = SqlSchema.findOne({
    Request: Capture.insert,
    Result: Capture,
    execute: (row) =>
      sql`INSERT INTO captures ${sql.insert({ ...row, payload: jsonb(row.payload) }).returning("*")}`,
  });

  const list = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Capture,
    execute: () => sql`SELECT * FROM captures ORDER BY created_at, seq`,
  });

  return {
    findById: repo.findById,
    update: repo.update,
    delete: repo.delete,
    insert,
    list,
  } as const;
});
