/**
 * @bloom/db: Postgres client, migrations, and the DB-backed implementations of
 * the @bloom/domain services. Repositories are internal.
 */
import { Layer } from "effect";
import { PgLive } from "./client.ts";
import { MigratorLive } from "./migrator.ts";
import { DbServicesLive } from "./services/index.ts";

export { PgLive, makePgLayer } from "./client.ts";
export { MigratorLive } from "./migrator.ts";
export {
  CaptureServiceDb,
  DbServicesLive,
  DeviceServiceDb,
  EventSinkDb,
  MessageServiceDb,
  TaskServiceDb,
  ThreadServiceDb,
} from "./services/index.ts";

/**
 * Everything the server needs: a migrated database (from `DATABASE_URL`) plus
 * every domain service, with `PgClient`/`SqlClient` also exposed.
 */
export const DbLive = DbServicesLive.pipe(
  Layer.provideMerge(MigratorLive),
  Layer.provideMerge(PgLive),
);
