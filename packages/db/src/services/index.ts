import { Layer } from "effect";
import { EventSinkDb } from "./event-sink.ts";
import { MessageServiceDb } from "./message-service.ts";
import { TaskServiceDb } from "./task-service.ts";
import { ThreadServiceDb } from "./thread-service.ts";

export { EventSinkDb, MessageServiceDb, TaskServiceDb, ThreadServiceDb };

/** All four domain services backed by Postgres. Requires a `SqlClient`. */
export const DbServicesLive = Layer.mergeAll(
  TaskServiceDb,
  ThreadServiceDb,
  MessageServiceDb,
  EventSinkDb,
);
