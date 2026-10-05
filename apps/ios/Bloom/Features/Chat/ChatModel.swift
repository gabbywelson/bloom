import BloomKit
import Foundation
import Observation

/// The main thread: history, the streaming reply, and sending.
@Observable
final class ChatModel {
    enum Load: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    private(set) var load: Load = .idle
    private(set) var thread: BloomThread?
    private(set) var messages: [ChatMessage] = []
    /// A reply is in flight: the composer is locked and the flower opens.
    private(set) var streaming = false
    /// Calm, user-facing text for the last failure.
    private(set) var error: String?

    /// How much history the phone loads; the server keeps everything.
    static let historyLimit = 80
    static let calmFailure = "That didn't go through. Give it a moment and try again."

    private let api: BloomAPI
    /// Called on `tasks_changed` so the task list refetches.
    private let onTasksChanged: () -> Void
    /// Called on any 401.
    private let onUnauthorized: () -> Void

    init(api: BloomAPI, onTasksChanged: @escaping () -> Void, onUnauthorized: @escaping () -> Void) {
        self.api = api
        self.onTasksChanged = onTasksChanged
        self.onUnauthorized = onUnauthorized
    }

    func loadIfNeeded() async {
        guard load == .idle else { return }
        await reload()
    }

    func reload() async {
        load = .loading
        do {
            let main = try await api.mainThread()
            let history = try await api.messages(threadId: main.id, limit: Self.historyLimit)
            thread = main
            // Keep anything sent while loading (rare, but never drop a turn).
            let loaded = history.map(ChatMessage.init)
            let pending = messages.filter { message in !loaded.contains { $0.id == message.id } }
            messages = loaded + pending
            load = .loaded
        } catch .unauthorized {
            onUnauthorized()
        } catch {
            load = .failed(error == .unreachable ? error.message : "Bloom couldn't open the conversation.")
        }
    }

    /// Sends one user turn and folds the reply in as it streams.
    /// Returns `true` when the stream ended normally (including a calm `error` event).
    @discardableResult
    func send(_ text: String) async -> Bool {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let thread, !text.isEmpty, !streaming else { return false }
        error = nil
        messages.append(.localUser(text))
        streaming = true
        defer { streaming = false }
        do {
            let events = try await api.send(threadId: thread.id, text: text)
            for try await event in events {
                messages = ChatTranscript.apply(event, to: messages)
                switch event {
                case .tasksChanged: onTasksChanged()
                case let .error(failure): error = failure.message
                default: break
                }
            }
            return true
        } catch BloomAPIError.unauthorized {
            onUnauthorized()
        } catch {
            self.error = (error as? BloomAPIError)?.message ?? Self.calmFailure
            // Drop an assistant bubble that never got content.
            messages.removeAll { $0.role == .assistant && $0.parts.isEmpty }
        }
        return false
    }
}
