import { Capture, CaptureId, CaptureStatus } from "@bloom/domain";
import { Effect, Schema } from "effect";
import { SqlClient, SqlModel, SqlSchema } from "effect/sql";
import { jsonb } from "./jsonb.ts";

const ListRequest = Schema.Struct({
  status: Schema.optionalKey(Schema.Array(CaptureStatus)),
});

/** Internal repository over the `captures` table; `payload` is jsonb. Lists order by (created_at, seq). */
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
    Request: ListRequest,
    Result: Capture,
    execute: (request) =>
      request.status === undefined
        ? sql`SELECT * FROM captures ORDER BY created_at, seq`
        : sql`SELECT * FROM captures WHERE ${sql.in("status", request.status)} ORDER BY created_at, seq`,
  });

  /** `findById` under a row lock, so concurrent triage patches serialize. */
  const findByIdForUpdate = SqlSchema.findOne({
    Request: CaptureId,
    Result: Capture,
    execute: (id) => sql`SELECT * FROM captures WHERE id = ${id} FOR UPDATE`,
  });

  return {
    findById: repo.findById,
    findByIdForUpdate,
    update: repo.update,
    delete: repo.delete,
    insert,
    list,
  } as const;
});
