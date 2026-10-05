import { Thread, ThreadId } from "@bloom/domain";
import { Effect, Schema } from "effect";
import { SqlClient, SqlModel, SqlSchema } from "effect/sql";

const TouchRequest = Schema.Struct({ id: ThreadId, at: Schema.DateTimeUtcFromDate });

/** Internal repository over the `threads` table. */
export const makeThreadRepo = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const repo = yield* SqlModel.makeRepository(Thread, {
    tableName: "threads",
    spanPrefix: "ThreadRepo",
    idColumn: "id",
  });

  const list = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Thread,
    execute: () => sql`SELECT * FROM threads ORDER BY created_at, seq`,
  });

  const findMain = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: Thread,
    execute: () => sql`SELECT * FROM threads WHERE kind = 'main' ORDER BY created_at, seq LIMIT 1`,
  });

  /**
   * Inserts the main thread unless one exists. The partial unique index on
   * `threads(kind) WHERE kind = 'main'` makes the race safe: a loser gets zero
   * rows back and re-reads the winner.
   */
  const insertMainIfAbsent = SqlSchema.findAll({
    Request: Thread.insert,
    Result: Thread,
    execute: (row) =>
      sql`INSERT INTO threads ${sql.insert(row)} ON CONFLICT (kind) WHERE kind = 'main' DO NOTHING RETURNING *`,
  });

  /** Sets last_message_at (and updated_at) to `at`; zero rows means the thread does not exist. */
  const touch = SqlSchema.findAll({
    Request: TouchRequest,
    Result: Thread,
    execute: ({ id, at }) =>
      sql`UPDATE threads SET last_message_at = ${at}, updated_at = ${at} WHERE id = ${id} RETURNING *`,
  });

  return { ...repo, list, findMain, insertMainIfAbsent, touch } as const;
});
