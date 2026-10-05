import { describe, expect, it } from "bun:test";
import { DateTime, Schema } from "effect";
import {
  DEFAULT_TIME_SENSITIVE_CAP,
  type NudgeCandidate,
  type NudgeKind,
  type PolicyAction,
  PolicyState,
  type PolicyState as PolicyStateType,
  decide,
  isQuietHour,
  localHour,
  netDismissals,
} from "../src/index.ts";

/** 14:00 UTC on a weekday: outside the default quiet window. */
const noon = DateTime.makeUnsafe("2026-10-05T14:00:00Z");
/** 23:00 UTC: inside a 22-7 quiet window. */
const lateNight = DateTime.makeUnsafe("2026-10-05T23:00:00Z");

const baseState: PolicyStateType = {
  now: noon,
  quietHours: { start: 22, end: 7 },
  sentToday: 0,
  dailyBudget: 5,
  timeSensitiveSentToday: 0,
  lowEnergy: false,
  focusWindow: false,
};

const candidate = (
  kind: NudgeKind,
  dismissedRecently = 0,
  actedOnRecently = 0,
): NudgeCandidate => ({
  kind,
  dismissedRecently,
  actedOnRecently,
});

interface Row {
  readonly name: string;
  readonly candidate: NudgeCandidate;
  readonly state: Partial<PolicyStateType>;
  readonly expected: PolicyAction;
  readonly reason: RegExp;
}

const rows: ReadonlyArray<Row> = [
  // Baseline
  {
    name: "chore within budget sends",
    candidate: candidate("chore"),
    state: {},
    expected: "send",
    reason: /within budget/,
  },
  {
    name: "self_care within budget sends",
    candidate: candidate("self_care"),
    state: {},
    expected: "send",
    reason: /within budget/,
  },

  // Daily budget
  {
    name: "chore at budget batches",
    candidate: candidate("chore"),
    state: { sentToday: 5 },
    expected: "batch",
    reason: /budget spent/,
  },
  {
    name: "chore over budget batches",
    candidate: candidate("chore"),
    state: { sentToday: 9 },
    expected: "batch",
    reason: /budget spent/,
  },
  {
    name: "self_care at budget batches when energy is normal",
    candidate: candidate("self_care"),
    state: { sentToday: 5 },
    expected: "batch",
    reason: /budget spent/,
  },
  {
    name: "zero budget batches everything non-urgent",
    candidate: candidate("chore"),
    state: { dailyBudget: 0 },
    expected: "batch",
    reason: /budget spent/,
  },

  // Time-sensitive: exempt from the daily budget only; own counter and cap
  {
    name: "time_sensitive sends within budget",
    candidate: candidate("time_sensitive"),
    state: {},
    expected: "send",
    reason: /time-sensitive/,
  },
  {
    name: "time_sensitive sends when the daily budget is spent",
    candidate: candidate("time_sensitive"),
    state: { sentToday: 7 },
    expected: "send",
    reason: /time-sensitive/,
  },
  {
    name: "time_sensitive sends with a zero daily budget",
    candidate: candidate("time_sensitive"),
    state: { dailyBudget: 0 },
    expected: "send",
    reason: /time-sensitive/,
  },
  {
    name: "time_sensitive ignores ordinary sends when rate limiting",
    candidate: candidate("time_sensitive"),
    state: { sentToday: 50, timeSensitiveSentToday: 0 },
    expected: "send",
    reason: /time-sensitive/,
  },
  {
    name: "time_sensitive sends on a low-energy day",
    candidate: candidate("time_sensitive"),
    state: { lowEnergy: true },
    expected: "send",
    reason: /time-sensitive/,
  },
  {
    name: "time_sensitive just under the default cap sends",
    candidate: candidate("time_sensitive"),
    state: { timeSensitiveSentToday: DEFAULT_TIME_SENSITIVE_CAP - 1 },
    expected: "send",
    reason: /time-sensitive/,
  },
  {
    name: "time_sensitive at the default cap drops",
    candidate: candidate("time_sensitive"),
    state: { timeSensitiveSentToday: DEFAULT_TIME_SENSITIVE_CAP },
    expected: "drop",
    reason: /rate limited/,
  },
  {
    name: "time_sensitive honours an explicit cap",
    candidate: candidate("time_sensitive"),
    state: { timeSensitiveSentToday: 2, timeSensitiveCap: 2 },
    expected: "drop",
    reason: /rate limited: 2 time-sensitive sent today, cap 2/,
  },
  {
    name: "time_sensitive with an explicit cap of zero always drops",
    candidate: candidate("time_sensitive"),
    state: { timeSensitiveCap: 0 },
    expected: "drop",
    reason: /rate limited/,
  },
  {
    name: "time_sensitive batches in quiet hours",
    candidate: candidate("time_sensitive"),
    state: { now: lateNight },
    expected: "batch",
    reason: /quiet hours/,
  },
  {
    name: "time_sensitive batches in a focus window",
    candidate: candidate("time_sensitive"),
    state: { focusWindow: true },
    expected: "batch",
    reason: /focus window/,
  },

  // Quiet hours (wrapping midnight) and focus windows
  {
    name: "chore in quiet hours batches",
    candidate: candidate("chore"),
    state: { now: lateNight },
    expected: "batch",
    reason: /quiet hours/,
  },
  {
    name: "self_care in quiet hours batches",
    candidate: candidate("self_care"),
    state: { now: lateNight },
    expected: "batch",
    reason: /quiet hours/,
  },
  {
    name: "chore after midnight still in quiet hours batches",
    candidate: candidate("chore"),
    state: { now: DateTime.makeUnsafe("2026-10-06T03:00:00Z") },
    expected: "batch",
    reason: /quiet hours/,
  },
  {
    name: "chore at quiet-hours end sends",
    candidate: candidate("chore"),
    state: { now: DateTime.makeUnsafe("2026-10-06T07:00:00Z") },
    expected: "send",
    reason: /within budget/,
  },
  {
    name: "chore at quiet-hours start batches",
    candidate: candidate("chore"),
    state: { now: DateTime.makeUnsafe("2026-10-05T22:00:00Z") },
    expected: "batch",
    reason: /quiet hours/,
  },
  {
    name: "non-wrapping quiet hours batch inside the window",
    candidate: candidate("chore"),
    state: { quietHours: { start: 13, end: 15 } },
    expected: "batch",
    reason: /quiet hours/,
  },
  {
    name: "quiet hours honour the time zone",
    candidate: candidate("chore"),
    // 05:00 UTC is quiet in UTC but 14:00 in Tokyo.
    state: { now: DateTime.makeUnsafe("2026-10-05T05:00:00Z"), timeZone: "Asia/Tokyo" },
    expected: "send",
    reason: /within budget/,
  },
  {
    name: "quiet hours in the local zone batch even when UTC is daytime",
    candidate: candidate("chore"),
    // 14:00 UTC is 23:00 in Tokyo.
    state: { now: noon, timeZone: "Asia/Tokyo" },
    expected: "batch",
    reason: /quiet hours .* local hour 23/,
  },
  {
    name: "disabled quiet hours never batch",
    candidate: candidate("chore"),
    state: { now: lateNight, quietHours: { start: 9, end: 9 } },
    expected: "send",
    reason: /within budget/,
  },
  {
    name: "chore in a focus window batches",
    candidate: candidate("chore"),
    state: { focusWindow: true },
    expected: "batch",
    reason: /focus window/,
  },
  {
    name: "self_care in a focus window batches even on low energy",
    candidate: candidate("self_care"),
    state: { focusWindow: true, lowEnergy: true },
    expected: "batch",
    reason: /focus window/,
  },
  {
    name: "info in a focus window batches with the focus reason",
    candidate: candidate("info"),
    state: { focusWindow: true },
    expected: "batch",
    reason: /focus window/,
  },

  // Info always batches
  {
    name: "info batches within budget",
    candidate: candidate("info"),
    state: {},
    expected: "batch",
    reason: /info/,
  },
  {
    name: "info batches on a low-energy day",
    candidate: candidate("info"),
    state: { lowEnergy: true },
    expected: "batch",
    reason: /info/,
  },

  // Back-off: hard drop at 3 net dismissals
  {
    name: "chore dismissed 3 times drops",
    candidate: candidate("chore", 3),
    state: {},
    expected: "drop",
    reason: /backing off:/,
  },
  {
    name: "self_care dismissed 4 times drops even on low energy",
    candidate: candidate("self_care", 4),
    state: { lowEnergy: true },
    expected: "drop",
    reason: /backing off:/,
  },
  {
    name: "info dismissed 3 times drops rather than batches",
    candidate: candidate("info", 3),
    state: {},
    expected: "drop",
    reason: /backing off:/,
  },
  {
    name: "time_sensitive dismissed 3 times drops",
    candidate: candidate("time_sensitive", 3),
    state: {},
    expected: "drop",
    reason: /backing off:/,
  },
  {
    name: "back-off drop wins over a focus window",
    candidate: candidate("chore", 3),
    state: { focusWindow: true },
    expected: "drop",
    reason: /backing off:/,
  },

  // Back-off: acted-on nudges cancel dismissals ("an acted-on one stays")
  {
    name: "chore dismissed 3 times but acted on once still sends, gently backed off",
    candidate: candidate("chore", 3, 1),
    state: {},
    expected: "batch",
    reason: /backing off gently: 2 net/,
  },
  {
    name: "chore dismissed 3 times and acted on 3 times sends normally",
    candidate: candidate("chore", 3, 3),
    state: {},
    expected: "send",
    reason: /within budget/,
  },
  {
    name: "chore acted on more than dismissed sends normally",
    candidate: candidate("chore", 2, 5),
    state: {},
    expected: "send",
    reason: /within budget/,
  },
  {
    name: "dismissed-only chore drops",
    candidate: candidate("chore", 5, 0),
    state: {},
    expected: "drop",
    reason: /backing off:/,
  },

  // Back-off: gradual (1-2 net dismissals batch instead of send)
  {
    name: "chore dismissed once batches instead of sending",
    candidate: candidate("chore", 1),
    state: {},
    expected: "batch",
    reason: /backing off gently: 1 net/,
  },
  {
    name: "chore dismissed twice batches instead of sending",
    candidate: candidate("chore", 2),
    state: {},
    expected: "batch",
    reason: /backing off gently: 2 net/,
  },
  {
    name: "self_care dismissed once batches even on low energy",
    candidate: candidate("self_care", 1),
    state: { lowEnergy: true },
    expected: "batch",
    reason: /backing off gently/,
  },
  {
    name: "time_sensitive dismissed twice still sends",
    candidate: candidate("time_sensitive", 2),
    state: {},
    expected: "send",
    reason: /time-sensitive/,
  },

  // Energy-aware
  {
    name: "low energy batches a chore within budget",
    candidate: candidate("chore"),
    state: { lowEnergy: true },
    expected: "batch",
    reason: /low energy raises/,
  },
  {
    name: "low energy sends self_care within budget",
    candidate: candidate("self_care"),
    state: { lowEnergy: true },
    expected: "send",
    reason: /low energy lowers/,
  },
  {
    name: "low energy sends self_care even at budget",
    candidate: candidate("self_care"),
    state: { lowEnergy: true, sentToday: 5 },
    expected: "send",
    reason: /even over budget/,
  },
  {
    name: "low energy does not override quiet hours for self_care",
    candidate: candidate("self_care"),
    state: { lowEnergy: true, now: lateNight },
    expected: "batch",
    reason: /quiet hours/,
  },
];

describe("interruption policy: decide", () => {
  for (const row of rows) {
    it(row.name, () => {
      const result = decide(row.candidate, { ...baseState, ...row.state });
      expect(result.action).toBe(row.expected);
      expect(result.reason).toMatch(row.reason);
    });
  }

  it("is pure: the same inputs always give the same decision", () => {
    const first = decide(candidate("chore"), baseState);
    const second = decide(candidate("chore"), baseState);
    expect(second).toEqual(first);
  });
});

describe("interruption policy: helpers", () => {
  it("isQuietHour handles plain, wrapping and disabled windows", () => {
    expect(isQuietHour(14, { start: 13, end: 15 })).toBe(true);
    expect(isQuietHour(15, { start: 13, end: 15 })).toBe(false);
    expect(isQuietHour(23, { start: 22, end: 7 })).toBe(true);
    expect(isQuietHour(0, { start: 22, end: 7 })).toBe(true);
    expect(isQuietHour(6, { start: 22, end: 7 })).toBe(true);
    expect(isQuietHour(7, { start: 22, end: 7 })).toBe(false);
    expect(isQuietHour(12, { start: 22, end: 7 })).toBe(false);
    expect(isQuietHour(9, { start: 9, end: 9 })).toBe(false);
  });

  it("localHour reads the UTC hour by default and the zoned hour when given a zone", () => {
    expect(localHour(noon)).toBe(14);
    expect(localHour(noon, "America/New_York")).toBe(10);
    expect(localHour(noon, "Asia/Tokyo")).toBe(23);
  });

  it("netDismissals subtracts acted-on nudges and never goes negative", () => {
    expect(netDismissals(candidate("chore", 3, 0))).toBe(3);
    expect(netDismissals(candidate("chore", 3, 1))).toBe(2);
    expect(netDismissals(candidate("chore", 1, 4))).toBe(0);
    expect(netDismissals(candidate("chore", 0, 0))).toBe(0);
  });
});

describe("interruption policy: schemas", () => {
  const codec = Schema.toCodecJson(PolicyState);

  it("decodes a JSON snapshot of the state", () => {
    const decoded = Schema.decodeSync(codec)({
      now: "2026-10-05T14:00:00Z",
      timeZone: "Europe/London",
      quietHours: { start: 22, end: 7 },
      sentToday: 2,
      dailyBudget: 5,
      timeSensitiveSentToday: 1,
      timeSensitiveCap: 4,
      lowEnergy: false,
      focusWindow: false,
    });
    expect(DateTime.formatIso(decoded.now)).toBe("2026-10-05T14:00:00.000Z");
    expect(decoded.timeZone).toBe("Europe/London");
    expect(decoded.timeSensitiveCap).toBe(4);
    expect(decide(candidate("chore"), decoded).action).toBe("send");
  });

  it("rejects hours outside 0-23, negative counts and unknown zones", () => {
    const valid = {
      now: "2026-10-05T14:00:00Z",
      quietHours: { start: 22, end: 7 },
      sentToday: 0,
      dailyBudget: 5,
      timeSensitiveSentToday: 0,
      lowEnergy: false,
      focusWindow: false,
    };
    const decode = Schema.decodeSync(codec);
    expect(() => decode({ ...valid, quietHours: { start: 24, end: 7 } })).toThrow();
    expect(() => decode({ ...valid, quietHours: { start: 22, end: -1 } })).toThrow();
    expect(() => decode({ ...valid, quietHours: { start: 22.5, end: 7 } })).toThrow();
    expect(() => decode({ ...valid, sentToday: -1 })).toThrow();
    expect(() => decode({ ...valid, dailyBudget: 1.5 })).toThrow();
    expect(() => decode({ ...valid, timeSensitiveSentToday: -2 })).toThrow();
    expect(() => decode({ ...valid, timeSensitiveCap: -1 })).toThrow();
    expect(() => decode({ ...valid, timeZone: "Mars/Olympus_Mons" })).toThrow();
    expect(decode(valid).timeZone).toBeUndefined();
    expect(decode(valid).timeSensitiveCap).toBeUndefined();
  });
});
