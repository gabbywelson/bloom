import Foundation

/// What the Home Screen widget shows: how many tasks are open and which one is
/// due next. Computed from the task list, cached in the app group so the
/// widget has something calm to show when the server is out of reach.
public struct TaskSnapshot: Codable, Equatable, Sendable {
    public struct NextTask: Codable, Equatable, Sendable {
        public let title: String
        public let due: Date

        public init(title: String, due: Date) {
            self.title = title
            self.due = due
        }
    }

    public let openCount: Int
    /// The open task with the earliest due date, if any task has one.
    public let next: NextTask?
    public let updatedAt: Date

    public init(openCount: Int, next: NextTask?, updatedAt: Date) {
        self.openCount = openCount
        self.next = next
        self.updatedAt = updatedAt
    }

    /// Open tasks only; the next task is the earliest `due` (ties: list order).
    public init(tasks: [BloomTask], now: Date = .now) {
        let open = tasks.filter { $0.status.isOpen }
        let dated = open.compactMap { task in task.dueDate.map { (task.title, $0) } }
        let next = dated.min { $0.1 < $1.1 }
        self.init(
            openCount: open.count,
            next: next.map { NextTask(title: $0.0, due: $0.1) },
            updatedAt: now
        )
    }

    /// Placeholder for widget galleries and previews.
    public static let sample = TaskSnapshot(
        openCount: 3,
        next: NextTask(title: "Water the plants", due: .now.addingTimeInterval(20 * 60 * 60)),
        updatedAt: .now
    )
}

/// The last snapshot, in the app group's defaults (ADR 0020).
public struct TaskSnapshotCache: @unchecked Sendable {
    // `UserDefaults` is thread-safe; it is not annotated Sendable.
    let defaults: UserDefaults
    static let key = "bloom.widget.tasks"

    public init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    /// The app group's cache, as named in the running bundle's Info.plist.
    public static var shared: TaskSnapshotCache {
        let suite = Bundle.main.infoDictionary?[SessionStore.appGroupKey] as? String
        return TaskSnapshotCache(defaults: suite.flatMap(UserDefaults.init(suiteName:)) ?? .standard)
    }

    public func load() -> TaskSnapshot? {
        defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(TaskSnapshot.self, from: $0) }
    }

    public func save(_ snapshot: TaskSnapshot) {
        if let data = try? JSONEncoder().encode(snapshot) { defaults.set(data, forKey: Self.key) }
    }

    public func clear() {
        defaults.removeObject(forKey: Self.key)
    }
}
