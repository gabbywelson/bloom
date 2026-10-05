import { Schema } from "effect";
import { Model } from "effect/schema";
import { Immutable, ImmutableTimestamp, Nullable } from "./fields.ts";
import { EventId } from "./ids.ts";

/**
 * Anything that happened that Bloom might care about: webhooks, pollers, client
 * uploads, internal timers. `dedupeKey` is unique in the DB so ingestion is idempotent.
 * Events are append-only: every field is write-once.
 */
export class Event extends Model.Class<Event>("Event")({
  id: Model.UuidV7Insert(EventId),
  /** Producer of the event, e.g. "system", "domain", "gmail". */
  source: Immutable(Schema.String),
  /** Producer-specific event type, e.g. "task.completed", "calendar.event_moved". */
  type: Immutable(Schema.String),
  occurredAt: ImmutableTimestamp,
  payload: Immutable(Schema.Json),
  dedupeKey: Nullable(Schema.String),
  createdAt: Model.DateTimeInsertFromDate,
}) {}

/** Input for `EventSink.ingest`; `dedupeKey` may be omitted. */
export const EventIngest = Schema.Struct({
  source: Schema.String,
  type: Schema.String,
  occurredAt: Schema.DateTimeUtcFromString,
  payload: Schema.Json,
  dedupeKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type EventIngest = typeof EventIngest.Type;
