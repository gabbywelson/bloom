import { Task, TaskId, TaskStatus } from "@bloom/domain";
import { Effect, Schema } from "effect";
import { SqlClient, SqlModel, SqlSchema } from "effect/sql";

const ListRequest = Schema.Struct({
  status: Schema.optionalKey(Schema.Array(TaskStatus)),
});

/** Internal repository over the `tasks` table. Lists order by (created_at, seq). */
export const makeTaskRepo = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const repo = yield* SqlModel.makeRepository(Task, {
    tableName: "tasks",
    spanPrefix: "TaskRepo",
    idColumn: "id",
  });

  const list = SqlSchema.findAll({
    Request: ListRequest,
    Result: Task,
    execute: (request) =>
      request.status === undefined
        ? sql`SELECT * FROM tasks ORDER BY created_at, seq`
        : sql`SELECT * FROM tasks WHERE ${sql.in("status", request.status)} ORDER BY created_at, seq`,
  });

  /**
   * Same as `findById` but takes a row lock for the rest of the transaction, so
   * read-merge-write patches cannot clobber a concurrent patch (lost update).
   */
  const findByIdForUpdate = SqlSchema.findOne({
    Request: TaskId,
    Result: Task,
    execute: (id) => sql`SELECT * FROM tasks WHERE id = ${id} FOR UPDATE`,
  });

  return { ...repo, list, findByIdForUpdate } as const;
});
