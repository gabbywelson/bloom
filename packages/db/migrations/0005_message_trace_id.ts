import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/** messages.trace_id: the OpenTelemetry trace of the run that wrote the message (ADR 0024). */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS trace_id text`;
});
