import { EventSink, MessageService, TaskService, ThreadService } from "@bloom/domain";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, ManagedRuntime, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { DbServicesLive, MigratorLive, makePgLayer } from "../src/index.ts";

/** Integration tests use their own database so the dev data is never touched. */
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://postgres:postgres@localhost:5432/bloom_test";

const parsed = new URL(TEST_DATABASE_URL);
const databaseName = parsed.pathname.replace(/^\//, "");
if (!/^[a-z_][a-z0-9_]*$/.test(databaseName)) {
  throw new Error(`refusing to use test database name "${databaseName}"`);
}
const adminUrl = new URL(TEST_DATABASE_URL);
adminUrl.pathname = "/postgres";

/** Creates the test database if it does not exist (connects to the `postgres` database). */
export const ensureTestDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`SELECT 1 FROM pg_database WHERE datname = ${databaseName}`;
  if (rows.length === 0) {
    yield* sql.unsafe(`CREATE DATABASE "${databaseName}"`);
  }
}).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(adminUrl.toString()) })));

export type DbServices = TaskService | ThreadService | MessageService | EventSink;

/** Migrated test database plus the four domain services and the SqlClient. */
export const TestDbLive = DbServicesLive.pipe(
  Layer.provideMerge(MigratorLive),
  Layer.provideMerge(makePgLayer(Redacted.make(TEST_DATABASE_URL))),
);

export const makeTestRuntime = () => ManagedRuntime.make(TestDbLive);

/** Empties every Bloom table (not the Better Auth ones) between tests. */
export const truncateAll = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`TRUNCATE tasks, threads, messages, events, nudges, captures`;
});
