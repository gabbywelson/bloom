import { DateTime, Option, Schema } from "effect";

/**
 * Interruption policy, v1 (ARCHITECTURE.md "Proactivity and nudges"). A pure
 * function over a small snapshot of state, so every decision is replayable in
 * the "why did Bloom do this?" panel and testable without a clock or database.
 */

/** Coarse category of a candidate nudge; drives budget, batching and energy rules. */
export const NudgeKind = Schema.Literals(["chore", "self_care", "time_sensitive", "info"]);
export type NudgeKind = typeof NudgeKind.Type;

/** A nudge that survived triage and is asking for permission to interrupt. */
export const NudgeCandidate = Schema.Struct({
  kind: NudgeKind,
  /** How many nudges of this kind were dismissed within the back-off window. */
  dismissedRecently: Schema.Natural,
  /**
   * How many nudges of this kind were acted on (done or snoozed) within the
   * back-off window. Each one cancels out a dismissal: "an acted-on one stays".
   */
  actedOnRecently: Schema.Natural,
});
export type NudgeCandidate = typeof NudgeCandidate.Type;

/** Hour of day, 0-23. */
export const Hour = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 23 }));
export type Hour = typeof Hour.Type;

/**
 * Daily window in local hours during which nothing fires. The window is
 * `[start, end)` and may wrap midnight (`{ start: 22, end: 7 }`).
 * `start === end` disables quiet hours.
 */
export const QuietHours = Schema.Struct({ start: Hour, end: Hour });
export type QuietHours = typeof QuietHours.Type;

/** IANA time zone id, validated against the runtime's zone database. */
export const TimeZoneId = Schema.String.check(
  Schema.makeFilter(
    (id: string) => Option.isSome(DateTime.zoneMakeNamed(id)) || "unknown IANA time zone",
    {
      title: "TimeZoneId",
    },
  ),
);
export type TimeZoneId = typeof TimeZoneId.Type;

/** Time-sensitive sends allowed per day when `PolicyState.timeSensitiveCap` is omitted. */
export const DEFAULT_TIME_SENSITIVE_CAP = 10;

/** Everything the policy needs to know about the moment a candidate arrives. */
export const PolicyState = Schema.Struct({
  now: Schema.DateTimeUtc,
  /** Zone used to read the local hour for quiet hours; UTC when omitted. */
  timeZone: Schema.optionalKey(TimeZoneId),
  quietHours: QuietHours,
  /** Non-time-sensitive nudges already sent today (excluding batched digests). */
  sentToday: Schema.Natural,
  /** Daily cap on non-time-sensitive sends. */
  dailyBudget: Schema.Natural,
  /** Time-sensitive nudges already sent today; counted separately from `sentToday`. */
  timeSensitiveSentToday: Schema.Natural,
  /** Daily cap on time-sensitive sends, independent of `dailyBudget`; defaults to 10. */
  timeSensitiveCap: Schema.optionalKey(Schema.Natural),
  /** Gabby reported a low-spoons day. */
  lowEnergy: Schema.Boolean,
  /** A calendar event tagged focus or therapy is in progress. */
  focusWindow: Schema.Boolean,
});
export type PolicyState = typeof PolicyState.Type;

/** `send` now, `batch` into the next digest, or `drop` for good. */
export const PolicyAction = Schema.Literals(["send", "batch", "drop"]);
export type PolicyAction = typeof PolicyAction.Type;

/** The decision plus a human-readable reason for the debug panel and `Nudge.reasoning`. */
export const PolicyDecision = Schema.Struct({ action: PolicyAction, reason: Schema.String });
export type PolicyDecision = typeof PolicyDecision.Type;

/** Net dismissals (dismissed minus acted-on) of one kind before that kind is dropped. */
export const BACKOFF_DISMISSALS = 3;

const decision = (action: PolicyAction, reason: string): PolicyDecision => ({ action, reason });

/** Local hour of `now` in `timeZone`, or the UTC hour when no zone is given. */
export const localHour = (now: DateTime.Utc, timeZone?: TimeZoneId): number => {
  const zoned = timeZone === undefined ? Option.none() : DateTime.setZoneNamed(now, timeZone);
  return DateTime.getPart(
    Option.getOrElse(zoned, () => now),
    "hour",
  );
};

/** Whether `hour` falls inside the half-open window, handling midnight wrap. */
export const isQuietHour = (hour: number, quietHours: QuietHours): boolean => {
  const { start, end } = quietHours;
  if (start === end) {
    return false;
  }
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
};

/**
 * Dismissals of this kind not cancelled out by an acted-on nudge of the same
 * kind within the back-off window. Never negative.
 */
export const netDismissals = (candidate: NudgeCandidate): number =>
  Math.max(0, candidate.dismissedRecently - candidate.actedOnRecently);

/**
 * Decide whether a candidate may interrupt right now.
 *
 * Rules, in precedence order:
 * 1. Back-off drop: `netDismissals >= 3` drops the candidate, whatever its kind.
 *    Acted-on nudges cancel dismissals, so a kind Gabby keeps using stays.
 * 2. Focus or therapy window: nothing fires, time-sensitive included
 *    (ARCHITECTURE.md: "no nudges during calendar events tagged as focus or therapy").
 * 3. Quiet hours: nothing fires, time-sensitive included. Time-sensitive items
 *    are exempt from the budget only, not from Gabby's quiet time.
 * 4. Time-sensitive: bypasses the daily budget, energy and gradual back-off,
 *    but is rate limited to `timeSensitiveCap` sends per day (own counter).
 * 5. Info is never worth an interruption; it rolls into the digest.
 * 6. Gradual back-off: `1 <= netDismissals < 3` batches instead of sending, so a
 *    dismissed kind gets less frequent before it disappears.
 * 7. Low energy raises the bar for chores (batch) and lowers it for self-care
 *    (send even when the budget is spent).
 * 8. Daily budget spent: batch.
 * 9. Otherwise send.
 */
export const decide = (candidate: NudgeCandidate, state: PolicyState): PolicyDecision => {
  const dismissals = netDismissals(candidate);
  if (dismissals >= BACKOFF_DISMISSALS) {
    return decision(
      "drop",
      `backing off: ${candidate.dismissedRecently} recent dismissals of ${candidate.kind}, ${candidate.actedOnRecently} acted on`,
    );
  }

  if (state.focusWindow) {
    return decision("batch", "focus window in progress: no nudges of any kind");
  }

  const hour = localHour(state.now, state.timeZone);
  if (isQuietHour(hour, state.quietHours)) {
    return decision(
      "batch",
      `quiet hours (${state.quietHours.start}-${state.quietHours.end}), local hour ${hour}`,
    );
  }

  if (candidate.kind === "time_sensitive") {
    const cap = state.timeSensitiveCap ?? DEFAULT_TIME_SENSITIVE_CAP;
    if (state.timeSensitiveSentToday >= cap) {
      return decision(
        "drop",
        `rate limited: ${state.timeSensitiveSentToday} time-sensitive sent today, cap ${cap}`,
      );
    }
    return decision("send", "time-sensitive: exempt from the daily budget");
  }

  if (candidate.kind === "info") {
    return decision("batch", "info is never urgent; rolled into the digest");
  }

  if (dismissals > 0) {
    return decision(
      "batch",
      `backing off gently: ${dismissals} net recent dismissals of ${candidate.kind}`,
    );
  }

  const budgetSpent = state.sentToday >= state.dailyBudget;

  if (state.lowEnergy && candidate.kind === "chore") {
    return decision("batch", "low energy raises the bar for chores");
  }
  if (state.lowEnergy && candidate.kind === "self_care") {
    return decision(
      "send",
      budgetSpent
        ? "low energy lowers the bar for self-care, even over budget"
        : "low energy lowers the bar for self-care",
    );
  }

  if (budgetSpent) {
    return decision(
      "batch",
      `daily budget spent: ${state.sentToday} of ${state.dailyBudget} sent today`,
    );
  }

  return decision("send", `within budget: ${state.sentToday} of ${state.dailyBudget} sent today`);
};
