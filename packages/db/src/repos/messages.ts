import { Message, MessageId, MessagePart, ThreadId } from "@bloom/domain";
import { Effect, Schema } from "effect";
import { SqlClient, SqlModel, SqlSchema } from "effect/sql";
import { jsonb } from "./jsonb.ts";

const ListRequest = Schema.Struct({
  threadId: ThreadId,
  limit: Schema.optionalKey(Schema.Int),
});

const ReplacePartsRequest = Schema.Struct({
  id: MessageId,
  parts: Schema.Array(MessagePart),
});

/**
 * Internal repository over the `messages` table. `parts` is jsonb and is bound
 * as JSON text on every write; pg would otherwise treat a JS array as a
 * Postgres array. Reads decode the parsed JSON through `Message`.
 */
export const makeMessageRepo = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const repo = yield* SqlModel.makeRepository(Message, {
    tableName: "messages",
    spanPrefix: "MessageRepo",
    idColumn: "id",
  });

  const insert = SqlSchema.findOne({
    Request: Message.insert,
    Result: Message,
    execute: (row) =>
      sql`INSERT INTO messages ${sql.insert({ ...row, parts: jsonb(row.parts) }).returning("*")}`,
  });

  /** Chronological; with `limit`, the most recent N still returned oldest-first. */
  const list = SqlSchema.findAll({
    Request: ListRequest,
    Result: Message,
    execute: ({ threadId, limit }) =>
      limit === undefined
        ? sql`SELECT * FROM messages WHERE thread_id = ${threadId} ORDER BY created_at, seq`
        : sql`
          SELECT * FROM (
            SELECT * FROM messages WHERE thread_id = ${threadId}
            ORDER BY created_at DESC, seq DESC LIMIT ${limit}
          ) recent ORDER BY created_at, seq`,
  });

  const replaceParts = SqlSchema.findAll({
    Request: ReplacePartsRequest,
    Result: Message,
    execute: ({ id, parts }) =>
      sql`UPDATE messages SET parts = ${jsonb(parts)}::jsonb WHERE id = ${id} RETURNING *`,
  });

  return { findById: repo.findById, delete: repo.delete, insert, list, replaceParts } as const;
});
