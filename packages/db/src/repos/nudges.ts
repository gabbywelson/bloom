import { Nudge } from "@bloom/domain";
import { Effect, Schema } from "effect";
import { SqlClient, SqlModel, SqlSchema } from "effect/sql";
import { jsonb } from "./jsonb.ts";

/** Internal repository over the `nudges` table; `actions` is jsonb. */
export const makeNudgeRepo = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const repo = yield* SqlModel.makeRepository(Nudge, {
    tableName: "nudges",
    spanPrefix: "NudgeRepo",
    idColumn: "id",
  });

  const insert = SqlSchema.findOne({
    Request: Nudge.insert,
    Result: Nudge,
    execute: (row) =>
      sql`INSERT INTO nudges ${sql.insert({ ...row, actions: jsonb(row.actions) }).returning("*")}`,
  });

  const list = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Nudge,
    execute: () => sql`SELECT * FROM nudges ORDER BY created_at, seq`,
  });

  return {
    findById: repo.findById,
    update: repo.update,
    delete: repo.delete,
    insert,
    list,
  } as const;
});
