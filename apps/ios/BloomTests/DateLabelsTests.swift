import BloomKit
import Foundation
import Testing

@Suite("Date labels")
struct DateLabelsTests {
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }

    /// Monday 2026-10-05, 09:00 in Los Angeles.
    var now: Date { calendar.date(from: DateComponents(year: 2026, month: 10, day: 5, hour: 9))! }

    private func day(_ offset: Int, hour: Int = 18) -> Date {
        let start = calendar.date(from: DateComponents(year: 2026, month: 10, day: 5 + offset, hour: hour))!
        return start
    }

    @Test("today, tomorrow and yesterday are words")
    func relative() {
        #expect(DateLabels.due(day(0), now: now, calendar: calendar) == "Today")
        #expect(DateLabels.due(day(1, hour: 0), now: now, calendar: calendar) == "Tomorrow")
        #expect(DateLabels.due(day(-1, hour: 23), now: now, calendar: calendar) == "Yesterday")
    }

    @Test("other days are a short local date; another year adds the year")
    func absolute() {
        #expect(DateLabels.due(day(3), now: now, calendar: calendar) == "Thu, Oct 8")
        let nextYear = calendar.date(from: DateComponents(year: 2027, month: 1, day: 4, hour: 9))!
        #expect(DateLabels.due(nextYear, now: now, calendar: calendar) == "Mon, Jan 4, 2027")
    }

    @Test("times are local wall-clock")
    func time() {
        let label = DateLabels.time(now, calendar: calendar)
        #expect(label.hasPrefix("9:00"))
        #expect(label.hasSuffix("AM"))
    }
}
