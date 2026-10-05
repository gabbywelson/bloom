/**
 * Small, calm date labels for the UI. Values arrive as `DateTime.Utc` from the
 * API and are rendered in the device's local zone.
 */
import { DateTime } from "effect";

const sameLocalDay = (a: DateTime.Utc, b: DateTime.Utc): boolean =>
  DateTime.toDate(a).toDateString() === DateTime.toDate(b).toDateString();

/** "Today", "Tomorrow", "Yesterday", or a short local date such as "Thu, Oct 8". */
export const dueLabel = (due: DateTime.Utc, now: DateTime.Utc = DateTime.nowUnsafe()): string => {
  if (sameLocalDay(due, now)) return "Today";
  if (sameLocalDay(due, DateTime.add({ days: 1 })(now))) return "Tomorrow";
  if (sameLocalDay(due, DateTime.subtract({ days: 1 })(now))) return "Yesterday";
  const sameYear = DateTime.toDate(due).getFullYear() === DateTime.toDate(now).getFullYear();
  return DateTime.formatLocal({
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })(due);
};

/** Local wall-clock time, e.g. "9:41 AM". */
export const timeLabel = (at: DateTime.Utc): string =>
  DateTime.formatLocal({ hour: "numeric", minute: "2-digit" })(at);
