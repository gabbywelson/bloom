import BloomKit
import Foundation
import HealthKit
import Observation

/// Sends one summary per completed day (steps, sleep, resting heart rate) to
/// the server as a `healthkit` / `daily_summary` Event (ADR 0021).
///
/// Opt-in from Settings. A no-op when Health data is unavailable (iPad, some
/// simulators), when the user has not turned it on, or when a day has no
/// data. Health numbers are private-tier: never logged, never shown to a model.
@Observable
final class HealthSync {
    enum Status: Equatable {
        case unavailable
        case off
        case on(lastSync: Date?)
        case syncing
    }

    private(set) var status: Status
    private(set) var lastResult: String?

    /// How many completed days each sync looks back over.
    static let lookbackDays = 7
    /// Syncs at most this often (repeats are harmless, but reading Health is not free).
    static let minimumInterval: TimeInterval = 6 * 60 * 60

    private let store = HKHealthStore()
    private let defaults: UserDefaults
    private static let enabledKey = "bloom.health.enabled"
    private static let lastSyncKey = "bloom.health.lastSync"

    private static let stepType = HKQuantityType(.stepCount)
    private static let restingHeartRateType = HKQuantityType(.restingHeartRate)
    private static let sleepType = HKCategoryType(.sleepAnalysis)

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if !HKHealthStore.isHealthDataAvailable() {
            status = .unavailable
        } else if defaults.bool(forKey: Self.enabledKey) {
            status = .on(lastSync: defaults.object(forKey: Self.lastSyncKey) as? Date)
        } else {
            status = .off
        }
    }

    var isEnabled: Bool {
        switch status {
        case .on, .syncing: true
        default: false
        }
    }

    /// Asks for read access to the three types and turns syncing on.
    func enable(api: BloomAPI) async {
        guard status != .unavailable else { return }
        do {
            try await store.requestAuthorization(
                toShare: [],
                read: [Self.stepType, Self.restingHeartRateType, Self.sleepType]
            )
        } catch {
            lastResult = "Apple Health didn't respond. Try again in Settings."
            return
        }
        defaults.set(true, forKey: Self.enabledKey)
        status = .on(lastSync: nil)
        await sync(api: api, force: true)
    }

    func disable() {
        defaults.set(false, forKey: Self.enabledKey)
        status = HKHealthStore.isHealthDataAvailable() ? .off : .unavailable
    }

    /// Summarizes the last completed days and posts the non-empty ones.
    /// Does nothing unless enabled, and at most every `minimumInterval` unless forced.
    func sync(api: BloomAPI, force: Bool = false, now: Date = .now) async {
        guard case let .on(lastSync) = status else { return }
        if !force, let lastSync, now.timeIntervalSince(lastSync) < Self.minimumInterval { return }
        status = .syncing
        var sent = 0
        let calendar = Calendar.current
        for day in HealthSummarizer.completedDays(before: now, count: Self.lookbackDays, calendar: calendar) {
            let summary = await summarize(day: day, calendar: calendar)
            guard !summary.isEmpty else { continue }
            do {
                if case .inserted = try await api.ingestEvent(summary.event) { sent += 1 }
            } catch {
                // Offline or signed out: try again next time; nothing is lost.
                lastResult = "Couldn't reach Bloom; Health summaries will go next time."
                status = .on(lastSync: lastSync)
                return
            }
        }
        defaults.set(now, forKey: Self.lastSyncKey)
        lastResult = sent == 0 ? "Up to date." : "Sent \(sent) day\(sent == 1 ? "" : "s") of Health summaries."
        status = .on(lastSync: now)
    }

    private func summarize(day: Date, calendar: Calendar) async -> DailyHealthSummary {
        let start = calendar.startOfDay(for: day)
        let end = calendar.date(byAdding: .day, value: 1, to: start) ?? start
        let dayPredicate = HKQuery.predicateForSamples(withStart: start, end: end)
        let window = HealthSummarizer.sleepWindow(for: start, calendar: calendar)

        let steps = await statistic(Self.stepType, .cumulativeSum, dayPredicate) { stats in
            stats.sumQuantity()?.doubleValue(for: .count())
        }
        let restingHeartRate = await statistic(Self.restingHeartRateType, .discreteAverage, dayPredicate) { stats in
            stats.averageQuantity()?.doubleValue(for: .count().unitDivided(by: .minute()))
        }
        let sleep = await asleepIntervals(in: window)
        return HealthSummarizer.summary(
            day: start, steps: steps, restingHeartRate: restingHeartRate, sleep: sleep, calendar: calendar
        )
    }

    private func statistic(
        _ type: HKQuantityType,
        _ options: HKStatisticsOptions,
        _ predicate: NSPredicate,
        value: (HKStatistics) -> Double?
    ) async -> Double? {
        let descriptor = HKStatisticsQueryDescriptor(
            predicate: HKSamplePredicate.quantitySample(type: type, predicate: predicate),
            options: options
        )
        guard let statistics = try? await descriptor.result(for: store) else { return nil }
        return value(statistics)
    }

    private func asleepIntervals(in window: DateInterval) async -> [SleepInterval] {
        let predicate = HKQuery.predicateForSamples(withStart: window.start, end: window.end)
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: Self.sleepType, predicate: predicate)],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        let asleep = HKCategoryValueSleepAnalysis.allAsleepValues.map(\.rawValue)
        let samples = (try? await descriptor.result(for: store)) ?? []
        return samples
            .filter { asleep.contains($0.value) }
            .map { SleepInterval(start: $0.startDate, end: $0.endDate) }
    }
}
