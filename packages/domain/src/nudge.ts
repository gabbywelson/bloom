import { Schema } from "effect";
import { Model } from "effect/schema";
import { Immutable, Nullable, ServerTimestamp } from "./fields.ts";
import { EventId, MessageId, NudgeId } from "./ids.ts";

/** Delivery channel for a nudge. */
export const NudgeChannel = Schema.Literals(["web_push", "inbox", "digest", "apns"]);
export type NudgeChannel = typeof NudgeChannel.Type;

/** What tapping a nudge action does. */
export const NudgeActionKind = Schema.Literals(["done", "snooze", "smaller", "open", "dismiss"]);
export type NudgeActionKind = typeof NudgeActionKind.Type;

/** One tappable action attached to a nudge. Every nudge carries at least one. */
export const NudgeAction = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: NudgeActionKind,
});
export type NudgeAction = typeof NudgeAction.Type;

/** How the user responded; training data for the interruption policy. */
export const NudgeOutcome = Schema.Literals(["done", "snoozed", "dismissed", "ignored"]);
export type NudgeOutcome = typeof NudgeOutcome.Type;

/**
 * A proactive message Bloom decided to send, with the reasoning and the outcome.
 * `body` is the user-facing text the Compose stage wrote in Bloom's voice;
 * `reasoning` is the internal "why" shown in the debug panel. Everything but
 * `outcome` (plus the service-owned timestamps) is write-once.
 */
export class Nudge extends Model.Class<Nudge>("Nudge")({
  id: Model.UuidV7Insert(NudgeId),
  triggerEventId: Nullable(EventId),
  /** Delivered text, in Bloom's voice. */
  body: Immutable(Schema.String),
  /** Internal explanation for the "why did Bloom do this?" panel. */
  reasoning: Immutable(Schema.String),
  channel: Immutable(NudgeChannel),
  actions: Immutable(Schema.NonEmptyArray(NudgeAction)),
  /** The inbox message this nudge landed as, when delivered into a thread. */
  messageId: Nullable(MessageId),
  sentAt: ServerTimestamp,
  outcome: Nullable(NudgeOutcome),
  outcomeAt: ServerTimestamp,
  createdAt: Model.DateTimeInsertFromDate,
}) {}
