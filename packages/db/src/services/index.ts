import { Layer } from "effect";
import { CaptureServiceDb } from "./capture-service.ts";
import { EventSinkDb } from "./event-sink.ts";
import { MessageServiceDb } from "./message-service.ts";
import { TaskServiceDb } from "./task-service.ts";
import { ThreadServiceDb } from "./thread-service.ts";

export { CaptureServiceDb, EventSinkDb, MessageServiceDb, TaskServiceDb, ThreadServiceDb };

/** Every domain service backed by Postgres. Requires a `SqlClient`. */
export const DbServicesLive = Layer.mergeAll(
  CaptureServiceDb,
  TaskServiceDb,
  ThreadServiceDb,
  MessageServiceDb,
  EventSinkDb,
);
