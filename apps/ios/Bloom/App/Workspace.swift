import BloomKit
import Foundation
import Observation

/// Everything that exists only while signed in: the API client for the
/// session's server and the feature models built on it. Dropped on sign-out,
/// so nothing from one session leaks into the next.
@Observable
final class Workspace {
    let api: BloomAPI
    let chat: ChatModel
    let tasks: TasksModel
    let captures: CapturesModel

    init(api: BloomAPI, onUnauthorized: @escaping () -> Void) {
        self.api = api
        let tasks = TasksModel(api: api, onUnauthorized: onUnauthorized)
        self.tasks = tasks
        captures = CapturesModel(api: api, onUnauthorized: onUnauthorized)
        chat = ChatModel(
            api: api,
            onTasksChanged: { Task { await tasks.refresh() } },
            onUnauthorized: onUnauthorized
        )
    }
}
