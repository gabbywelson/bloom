import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Core Bloom tables. Columns mirror the `Model.Class` fields in @bloom/domain
 * (snake_case here, camelCase in TS via the client transforms). Ids are text
 * (UUIDv7 strings from `Model.UuidV7Insert`), timestamps are timestamptz, and
 * JSON-shaped columns are jsonb. `seq` is an insertion counter used only as the
 * ORDER BY tiebreaker after created_at: UUIDv7 ids share a millisecond prefix and
 * the remaining bits are random, so ordering by id alone is not insertion order.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // tasks: a thing to do once; the central domain object (see Task).
  yield* sql`
    CREATE TABLE tasks (
      id            text PRIMARY KEY,
      seq           bigint GENERATED ALWAYS AS IDENTITY,
      title         text NOT NULL CHECK (title <> ''),
      notes         text,
      status        text NOT NULL CHECK (status IN ('inbox', 'next', 'scheduled', 'waiting', 'done', 'dropped')),
      due           timestamptz,
      scheduled_for timestamptz,
      effort        integer CHECK (effort BETWEEN 1 AND 5),
      energy_kind   text CHECK (energy_kind IN ('focus', 'admin', 'physical', 'social', 'rest')),
      area          text,
      source        text NOT NULL CHECK (source IN ('user', 'agent', 'import', 'integration')),
      parent_id     text REFERENCES tasks (id) ON DELETE SET NULL,
      completed_at  timestamptz,
      created_at    timestamptz NOT NULL,
      updated_at    timestamptz NOT NULL
    )
  `;
  yield* sql`CREATE INDEX tasks_status_idx ON tasks (status)`;
  yield* sql`CREATE INDEX tasks_created_at_seq_idx ON tasks (created_at, seq)`;

  // threads: conversations; exactly one row has kind = 'main' (see Thread).
  yield* sql`
    CREATE TABLE threads (
      id               text PRIMARY KEY,
      seq              bigint GENERATED ALWAYS AS IDENTITY,
      kind             text NOT NULL CHECK (kind IN ('main', 'side', 'quest')),
      parent_thread_id text REFERENCES threads (id) ON DELETE SET NULL,
      topic            text,
      context_scope    text NOT NULL CHECK (context_scope IN ('full', 'minimal')),
      status           text NOT NULL CHECK (status IN ('active', 'archived')),
      last_message_at  timestamptz,
      created_at       timestamptz NOT NULL,
      updated_at       timestamptz NOT NULL
    )
  `;
  yield* sql`CREATE UNIQUE INDEX threads_single_main_idx ON threads (kind) WHERE kind = 'main'`;
  yield* sql`CREATE INDEX threads_created_at_seq_idx ON threads (created_at, seq)`;

  // messages: one turn in a thread; parts is a jsonb array of MessagePart (see Message).
  yield* sql`
    CREATE TABLE messages (
      id         text PRIMARY KEY,
      seq        bigint GENERATED ALWAYS AS IDENTITY,
      thread_id  text NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
      role       text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
      parts      jsonb NOT NULL,
      run_id     text,
      created_at timestamptz NOT NULL
    )
  `;
  yield* sql`CREATE INDEX messages_thread_created_idx ON messages (thread_id, created_at, seq)`;

  // events: append-only log of anything Bloom might care about, incl. domain audit events (see Event).
  yield* sql`
    CREATE TABLE events (
      id          text PRIMARY KEY,
      seq         bigint GENERATED ALWAYS AS IDENTITY,
      source      text NOT NULL,
      type        text NOT NULL,
      occurred_at timestamptz NOT NULL,
      payload     jsonb NOT NULL,
      dedupe_key  text,
      created_at  timestamptz NOT NULL
    )
  `;
  yield* sql`CREATE UNIQUE INDEX events_dedupe_key_idx ON events (dedupe_key) WHERE dedupe_key IS NOT NULL`;
  yield* sql`CREATE INDEX events_created_at_seq_idx ON events (created_at, seq)`;
  yield* sql`CREATE INDEX events_occurred_at_idx ON events (occurred_at)`;
  yield* sql`CREATE INDEX events_source_type_idx ON events (source, type)`;

  // nudges: proactive messages Bloom decided to send, with reasoning and outcome (see Nudge).
  yield* sql`
    CREATE TABLE nudges (
      id               text PRIMARY KEY,
      seq              bigint GENERATED ALWAYS AS IDENTITY,
      trigger_event_id text REFERENCES events (id) ON DELETE SET NULL,
      body             text NOT NULL,
      reasoning        text NOT NULL,
      channel          text NOT NULL CHECK (channel IN ('web_push', 'inbox', 'digest', 'apns')),
      actions          jsonb NOT NULL,
      message_id       text REFERENCES messages (id) ON DELETE SET NULL,
      sent_at          timestamptz,
      outcome          text CHECK (outcome IN ('done', 'snoozed', 'dismissed', 'ignored')),
      outcome_at       timestamptz,
      created_at       timestamptz NOT NULL
    )
  `;
  yield* sql`CREATE INDEX nudges_created_at_seq_idx ON nudges (created_at, seq)`;

  // captures: raw input (text, voice, share, image) waiting for triage (see Capture).
  yield* sql`
    CREATE TABLE captures (
      id         text PRIMARY KEY,
      seq        bigint GENERATED ALWAYS AS IDENTITY,
      kind       text NOT NULL CHECK (kind IN ('text', 'voice', 'share', 'image')),
      payload    jsonb NOT NULL,
      transcript text,
      status     text NOT NULL CHECK (status IN ('new', 'routed', 'dismissed')),
      routed_to  text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  yield* sql`CREATE INDEX captures_status_idx ON captures (status)`;
  yield* sql`CREATE INDEX captures_created_at_seq_idx ON captures (created_at, seq)`;
});
