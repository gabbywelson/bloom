/**
 * @bloom/domain: the shared contract for db, api, agent, and web.
 * Entities are Effect `Model.Class`es with DB and JSON variants; unions are
 * tagged; services are `Context.Service` tags with in-memory layers for tests.
 */
export * from "./actor.ts";
export * from "./capture.ts";
export * from "./errors.ts";
export * from "./event.ts";
export * from "./fields.ts";
export * from "./ids.ts";
export * from "./message-part.ts";
export * from "./message.ts";
export * from "./nudge.ts";
export * from "./run.ts";
export * from "./sensitivity.ts";
export * from "./stream.ts";
export * from "./task.ts";
export * from "./thread.ts";
export * from "./ui-component.ts";
export * from "./services/capture-service.ts";
export * from "./services/event-sink.ts";
export * from "./services/message-service.ts";
export * from "./services/task-service.ts";
export * from "./services/thread-service.ts";

export * as Fields from "./fields.ts";
export * as Ids from "./ids.ts";
export * as MessageParts from "./message-part.ts";
export * as UiComponents from "./ui-component.ts";
export * as Stream from "./stream.ts";
export * as Errors from "./errors.ts";
export * as Services from "./services/index.ts";
