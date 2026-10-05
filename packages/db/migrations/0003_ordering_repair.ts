import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/** Every Bloom table orders by `(created_at, seq)` (ADR 0012). */
export const orderedTables = [
  "tasks",
  "threads",
  "messages",
  "events",
  "nudges",
  "captures",
] as const;

/**
 * Repairs databases that ran an early version of `0002_bloom_core`.
 *
 * `seq` and the `(created_at, seq)` indexes were added to 0002 in place during
 * Phase 0 (ADR 0012), so a database migrated before that edit (found tonight:
 * the `bloom_test` database) lacks `seq` on `captures` and `nudges` and keeps
 * the superseded `nudges_created_at_id_idx`. Every statement is idempotent, so
 * on an up-to-date database this migration changes nothing. Adding an identity
 * column numbers existing rows; their relative order within a millisecond is
 * whatever Postgres scans first, which is the best that can be recovered.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const table of orderedTables) {
    yield* sql.unsafe(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY`,
    );
  }
  yield* sql`CREATE INDEX IF NOT EXISTS tasks_created_at_seq_idx ON tasks (created_at, seq)`;
  yield* sql`CREATE INDEX IF NOT EXISTS threads_created_at_seq_idx ON threads (created_at, seq)`;
  yield* sql`CREATE INDEX IF NOT EXISTS messages_thread_created_idx ON messages (thread_id, created_at, seq)`;
  yield* sql`CREATE INDEX IF NOT EXISTS events_created_at_seq_idx ON events (created_at, seq)`;
  yield* sql`CREATE INDEX IF NOT EXISTS nudges_created_at_seq_idx ON nudges (created_at, seq)`;
  yield* sql`CREATE INDEX IF NOT EXISTS captures_created_at_seq_idx ON captures (created_at, seq)`;
  yield* sql`DROP INDEX IF EXISTS nudges_created_at_id_idx`;
});
