import BloomKit
import Foundation
import Testing

/// The simulator has no Health data, so the summarizer is tested with fixtures.
@Suite("Health summaries")
struct HealthSummaryTests {
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return calendar
    }

    /// 2026-10-04 (Sunday) at `hour:minute` local time, with a day offset.
    private func at(_ hour: Int, _ minute: Int = 0, day: Int = 4) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    @Test("the night before a day counts for that day: noon to noon")
    func sleepWindow() {
        let window = HealthSummarizer.sleepWindow(for: at(15), calendar: calendar)
        #expect(window.start == at(12, day: 3))
        #expect(window.end == at(12))
    }

    @Test("overlapping samples from two devices count once")
    func mergesOverlaps() {
        let window = HealthSummarizer.sleepWindow(for: at(0), calendar: calendar)
        let phone = SleepInterval(start: at(23, day: 3), end: at(6, 30))
        let watchCore = SleepInterval(start: at(23, 15, day: 3), end: at(3))
        let watchRem = SleepInterval(start: at(3), end: at(7))
        // 23:00 -> 07:00 merged = 8 hours.
        #expect(HealthSummarizer.asleepMinutes([watchRem, phone, watchCore], in: window) == 480)
    }

    @Test("gaps stay gaps, and sleep outside the window is clipped")
    func gapsAndClipping() {
        let window = HealthSummarizer.sleepWindow(for: at(0), calendar: calendar)
        let night = [
            SleepInterval(start: at(23, day: 3), end: at(2)),        // 3 h
            SleepInterval(start: at(2, 30), end: at(6)),             // 3.5 h, after a 30 min wake
            SleepInterval(start: at(11, 30), end: at(13)),           // nap: only 30 min before noon counts
            SleepInterval(start: at(9, day: 3), end: at(11, day: 3)), // before the window
        ]
        #expect(HealthSummarizer.asleepMinutes(night, in: window) == 180 + 210 + 30)
        #expect(HealthSummarizer.asleepMinutes([], in: window) == 0)
    }

    @Test("a day's summary rounds the numbers and names the local day")
    func summary() {
        let summary = HealthSummarizer.summary(
            day: at(21),
            steps: 8123.6,
            restingHeartRate: 57.6,
            sleep: [SleepInterval(start: at(23, 30, day: 3), end: at(7, 2))],
            calendar: calendar
        )
        #expect(summary.day == "2026-10-04")
        #expect(summary.timeZone == "America/Los_Angeles")
        #expect(summary.dayStart == at(0))
        #expect(summary.steps == 8124)
        #expect(summary.restingHeartRate == 58)
        #expect(summary.sleepMinutes == 452)
        #expect(!summary.isEmpty)
    }

    @Test("a day without data is empty, so nothing is sent for it")
    func emptyDay() {
        let summary = HealthSummarizer.summary(day: at(12), steps: nil, restingHeartRate: nil, sleep: [], calendar: calendar)
        #expect(summary.isEmpty)
        #expect(summary.sleepMinutes == nil)
    }

    @Test("the event is healthkit/daily_summary keyed by day, with only known numbers")
    func event() throws {
        let summary = HealthSummarizer.summary(day: at(12), steps: 4200, restingHeartRate: nil, sleep: [], calendar: calendar)
        let event = summary.event
        #expect(event.source == "healthkit")
        #expect(event._type == "daily_summary")
        #expect(event.dedupeKey == "healthkit:2026-10-04")
        #expect(BloomDate.parse(event.occurredAt) == at(0))
        let data = try JSONEncoder().encode(event.payload)
        let payload = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(payload as NSDictionary == [
            "day": "2026-10-04", "timeZone": "America/Los_Angeles", "steps": 4200,
        ] as NSDictionary)
    }

    @Test("only completed days are synced, most recent first")
    func completedDays() {
        let days = HealthSummarizer.completedDays(before: at(9, day: 5), count: 3, calendar: calendar)
        #expect(days == [at(0, day: 4), at(0, day: 3), at(0, day: 2)])
    }
}
