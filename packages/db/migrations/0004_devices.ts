import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * devices: phones registered for push (see Device, ADR 0023). One row per
 * APNs token; re-registering the same token updates it in place.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE devices (
      id               text PRIMARY KEY,
      seq              bigint GENERATED ALWAYS AS IDENTITY,
      platform         text NOT NULL CHECK (platform IN ('ios')),
      push_token       text NOT NULL UNIQUE CHECK (push_token <> ''),
      push_environment text NOT NULL CHECK (push_environment IN ('sandbox', 'production')),
      name             text,
      app_version      text,
      created_at       timestamptz NOT NULL,
      updated_at       timestamptz NOT NULL
    )
  `;
  yield* sql`CREATE INDEX devices_created_at_seq_idx ON devices (created_at, seq)`;
});
