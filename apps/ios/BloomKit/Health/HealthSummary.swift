import Foundation
import OpenAPIRuntime

/// One stretch of sleep as HealthKit reports it (asleep stages only).
public struct SleepInterval: Equatable, Sendable {
    public let start: Date
    public let end: Date

    public init(start: Date, end: Date) {
        self.start = start
        self.end = end
    }
}

/// A day of Apple Health, reduced to three numbers. Private-tier data
/// (ADR 0021): it is sent to the server as an `Event` and never put into a
/// model context in this phase.
public struct DailyHealthSummary: Equatable, Sendable {
    /// The local calendar day, `yyyy-MM-dd`.
    public let day: String
    /// IANA zone the day was computed in.
    public let timeZone: String
    /// Start of the day in that zone (the event's `occurredAt`).
    public let dayStart: Date
    public let steps: Int?
    /// Minutes asleep in the night that ended that morning.
    public let sleepMinutes: Int?
    /// Average resting heart rate, beats per minute.
    public let restingHeartRate: Int?

    /// A day the phone knows nothing about is not worth an event.
    public var isEmpty: Bool { steps == nil && sleepMinutes == nil && restingHeartRate == nil }

    /// The event the server stores: `healthkit` / `daily_summary`, keyed
    /// `healthkit:<day>` so re-syncing a day is a no-op.
    public var event: Components.Schemas.EventIngest {
        var fields: [String: (any Sendable)?] = ["day": day, "timeZone": timeZone]
        if let steps { fields["steps"] = steps }
        if let sleepMinutes { fields["sleepMinutes"] = sleepMinutes }
        if let restingHeartRate { fields["restingHeartRate"] = restingHeartRate }
        return .init(
            source: "healthkit",
            _type: "daily_summary",
            occurredAt: BloomDate.format(dayStart),
            payload: (try? OpenAPIValueContainer(unvalidatedValue: fields)) ?? nil,
            dedupeKey: "healthkit:\(day)"
        )
    }
}

/// Pure arithmetic over what HealthKit returned; the HealthKit queries live
/// in the app. Unit-tested with fixtures, since the simulator has no data.
public enum HealthSummarizer {
    /// The night that belongs to a day: the 24 hours ending at noon that day,
    /// so a night from 23:00 to 07:00 counts for the morning it ends on.
    public static func sleepWindow(for day: Date, calendar: Calendar) -> DateInterval {
        let start = calendar.startOfDay(for: day)
        let noon = calendar.date(byAdding: .hour, value: 12, to: start) ?? start
        let previousNoon = calendar.date(byAdding: .day, value: -1, to: noon) ?? noon
        return DateInterval(start: previousNoon, end: noon)
    }

    /// Minutes asleep inside `window`. Overlapping samples (iPhone and Watch
    /// both recording, or overlapping stages) are merged first so no minute
    /// counts twice; anything outside the window is clipped.
    public static func asleepMinutes(_ intervals: [SleepInterval], in window: DateInterval) -> Int {
        let clipped = intervals
            .map { SleepInterval(start: max($0.start, window.start), end: min($0.end, window.end)) }
            .filter { $0.end > $0.start }
            .sorted { $0.start < $1.start }
        var total: TimeInterval = 0
        var current: SleepInterval?
        for interval in clipped {
            if let open = current, interval.start <= open.end {
                current = SleepInterval(start: open.start, end: max(open.end, interval.end))
            } else {
                if let open = current { total += open.end.timeIntervalSince(open.start) }
                current = interval
            }
        }
        if let open = current { total += open.end.timeIntervalSince(open.start) }
        return Int((total / 60).rounded())
    }

    /// Builds a day's summary. `steps` and `restingHeartRate` come from
    /// HealthKit statistics queries (already de-duplicated across sources);
    /// `sleep` is the asleep samples around the day.
    public static func summary(
        day: Date,
        steps: Double?,
        restingHeartRate: Double?,
        sleep: [SleepInterval],
        calendar: Calendar
    ) -> DailyHealthSummary {
        let start = calendar.startOfDay(for: day)
        let components = calendar.dateComponents([.year, .month, .day], from: start)
        let dayString = String(
            format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0
        )
        let minutes = asleepMinutes(sleep, in: sleepWindow(for: start, calendar: calendar))
        return DailyHealthSummary(
            day: dayString,
            timeZone: calendar.timeZone.identifier,
            dayStart: start,
            steps: steps.map { Int($0.rounded()) },
            sleepMinutes: minutes > 0 ? minutes : nil,
            restingHeartRate: restingHeartRate.map { Int($0.rounded()) }
        )
    }

    /// The last `count` days that are over, most recent first. Today is never
    /// included: its numbers are still growing, and the first summary of a day
    /// wins (the server de-duplicates by day).
    public static func completedDays(before now: Date, count: Int, calendar: Calendar) -> [Date] {
        let today = calendar.startOfDay(for: now)
        return (1...max(1, count)).compactMap { calendar.date(byAdding: .day, value: -$0, to: today) }
    }
}
