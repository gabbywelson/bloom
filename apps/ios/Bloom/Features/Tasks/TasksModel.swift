import BloomKit
import Foundation
import Observation
import WidgetKit

/// Open tasks, kept fresh: refetched on appear, on pull-to-refresh, after
/// completing one, and whenever a chat run reports `tasks_changed`.
@Observable
final class TasksModel {
    private(set) var tasks: [BloomTask] = []
    private(set) var loading = false
    private(set) var loadedOnce = false
    /// The task whose "done" request is in flight.
    private(set) var completing: String?
    private(set) var error: String?

    private let api: BloomAPI
    private let onUnauthorized: () -> Void
    /// Whether refreshes update the widget's cached snapshot (not in demo mode).
    private let publishesSnapshot: Bool
    private var pendingRefresh = false

    init(api: BloomAPI, publishesSnapshot: Bool = true, onUnauthorized: @escaping () -> Void) {
        self.api = api
        self.publishesSnapshot = publishesSnapshot
        self.onUnauthorized = onUnauthorized
    }

    /// Open tasks only, as the web's list shows them, in creation order.
    var open: [BloomTask] { tasks.filter { $0.status.isOpen } }

    func refresh() async {
        // Coalesce: a refresh requested mid-flight runs once more afterwards.
        guard !loading else {
            pendingRefresh = true
            return
        }
        loading = true
        defer { loading = false }
        repeat {
            pendingRefresh = false
            do {
                tasks = try await api.tasks(status: BloomTaskStatus.open)
                error = nil
                loadedOnce = true
                publishSnapshot()
            } catch .unauthorized {
                onUnauthorized()
                return
            } catch {
                self.error = "Couldn't refresh tasks just now."
            }
        } while pendingRefresh
    }

    /// Marks a task done; returns `true` when the server accepted it.
    @discardableResult
    func complete(_ id: String) async -> Bool {
        guard completing == nil else { return false }
        completing = id
        error = nil
        defer { completing = nil }
        do {
            let done = try await api.completeTask(id: id)
            if let index = tasks.firstIndex(where: { $0.id == id }) { tasks[index] = done }
            await refresh()
            return true
        } catch .unauthorized {
            onUnauthorized()
        } catch .notFound {
            await refresh()
        } catch {
            self.error = "Couldn't mark that done just now."
        }
        return false
    }

    /// Keeps the Home Screen widget in step with what the app just saw.
    private func publishSnapshot() {
        guard publishesSnapshot else { return }
        let snapshot = TaskSnapshot(tasks: tasks)
        let cache = TaskSnapshotCache.shared
        guard cache.load().map({ $0.openCount != snapshot.openCount || $0.next != snapshot.next }) ?? true else { return }
        cache.save(snapshot)
        WidgetCenter.shared.reloadTimelines(ofKind: "dev.bloom.tasks")
    }
}
