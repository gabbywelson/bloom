import BloomKit
import Foundation
import Testing

@Suite("Widget task snapshot")
struct TaskSnapshotTests {
    private func task(_ title: String, status: BloomTaskStatus = .next, due: String? = nil) -> BloomTask {
        BloomTask(
            id: title, title: title, notes: nil, status: status, due: due, scheduledFor: nil, effort: nil,
            energyKind: nil, area: nil, source: .user, parentId: nil, completedAt: nil,
            createdAt: "2026-10-04T08:00:00.000Z", updatedAt: "2026-10-04T08:00:00.000Z"
        )
    }

    @Test("counts open tasks and picks the earliest due one")
    func snapshot() {
        let snapshot = TaskSnapshot(tasks: [
            task("Call the dentist", due: "2026-10-08T17:00:00.000Z"),
            task("Water the plants", due: "2026-10-06T07:00:00.000Z"),
            task("Read", due: nil),
            task("Old thing", status: .done, due: "2026-10-01T07:00:00.000Z"),
            task("Dropped", status: .dropped),
        ])
        #expect(snapshot.openCount == 3)
        #expect(snapshot.next?.title == "Water the plants")
        #expect(snapshot.next?.due == BloomDate.parse("2026-10-06T07:00:00Z"))
    }

    @Test("no due dates means no next task")
    func nothingDue() {
        let snapshot = TaskSnapshot(tasks: [task("Read")])
        #expect(snapshot.openCount == 1)
        #expect(snapshot.next == nil)
        #expect(TaskSnapshot(tasks: []).openCount == 0)
    }

    @Test("the cache round-trips and clears")
    func cache() throws {
        let cache = TaskSnapshotCache(defaults: try #require(UserDefaults(suiteName: "bloom.tests.\(UUID().uuidString)")))
        #expect(cache.load() == nil)
        let snapshot = TaskSnapshot(openCount: 2, next: .init(title: "Water", due: Date(timeIntervalSince1970: 1_791_300_000)), updatedAt: Date(timeIntervalSince1970: 1_791_200_000))
        cache.save(snapshot)
        #expect(cache.load() == snapshot)
        cache.clear()
        #expect(cache.load() == nil)
    }
}
