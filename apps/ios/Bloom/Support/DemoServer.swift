#if DEBUG
import BloomKit
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization

/// An in-process stand-in for the Bloom server, for UI tests and previews
/// (`-BloomDemo` launch argument, debug builds only). It answers the same
/// generated client with the same wire types, so the UI runs exactly as it
/// would against a real server, minus the network and the model.
///
/// Chat: a message starting with "Add " creates a task named by the rest and
/// streams the ADR 0013 tool round; anything else gets a short plain reply.
nonisolated final class DemoServer: ClientTransport, Sendable {
    static let url = URL(string: "http://bloom.demo")!
    static let user = BloomUser(id: "demo-user", email: "owner@example.com", name: "Owner")
    static let thread = BloomThread(
        id: "demo-thread", kind: .main, parentThreadId: nil, topic: nil, contextScope: .full,
        status: .active, lastMessageAt: nil, createdAt: BloomDate.format(.now), updatedAt: BloomDate.format(.now)
    )

    private struct State {
        var tasks: [BloomTask]
        var messages: [BloomMessage]
        var captures: [BloomCapture] = []
        var counter = 0
    }

    private let state: Mutex<State>

    init() {
        let now = BloomDate.format(.now)
        let task = { (id: String, title: String, area: String?) in
            BloomTask(
                id: id, title: title, notes: nil, status: .next, due: nil, scheduledFor: nil, effort: 1,
                energyKind: nil, area: area, source: .user, parentId: nil, completedAt: nil,
                createdAt: now, updatedAt: now
            )
        }
        state = Mutex(State(
            tasks: [task("demo-task-1", "Call the dentist", "Health"), task("demo-task-2", "Water the plants", "Home")],
            messages: [BloomMessage(
                id: "demo-message-0", threadId: Self.thread.id, role: .assistant,
                parts: [.text(.init(_type: .text, text: "Morning. Two small things on the list today."))],
                runId: nil, createdAt: now
            )]
        ))
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        switch operationID {
        case "me.get": return try json(Self.user)
        case "health.check":
            return try json(Components.Schemas.HealthStatus(status: .ok, service: .bloomServer, time: BloomDate.format(.now)))
        case "threads.main": return try json(Self.thread)
        case "threads.messages": return try json(state.withLock { $0.messages })
        case "tasks.list": return try json(state.withLock { $0.tasks.filter { $0.status.isOpen } })
        case "tasks.complete":
            let id = request.path?.split(separator: "/").dropLast().last.map(String.init) ?? ""
            let done: BloomTask? = state.withLock { state in
                guard let index = state.tasks.firstIndex(where: { $0.id == id }) else { return nil }
                state.tasks[index].status = .done
                state.tasks[index].completedAt = BloomDate.format(.now)
                return state.tasks[index]
            }
            guard let done else { return (HTTPResponse(status: .notFound), nil) }
            return try json(done)
        case "captures.list":
            return try json(state.withLock { $0.captures.filter { $0.status == .new } })
        case "captures.create":
            let input = try await JSONDecoder().decode(
                BloomCaptureCreate.self,
                from: Data(collecting: body ?? HTTPBody(), upTo: 1 << 22)
            )
            let now = BloomDate.format(.now)
            let capture = state.withLock { state in
                state.counter += 1
                let capture = BloomCapture(
                    id: "demo-capture-\(state.counter)", kind: input.kind, payload: input.payload,
                    transcript: nil, status: .new, routedTo: nil, createdAt: now, updatedAt: now
                )
                state.captures.append(capture)
                return capture
            }
            return try json(capture)
        case "captures.update":
            let patch = try await JSONDecoder().decode(
                Components.Schemas.CaptureUpdate.self,
                from: Data(collecting: body ?? HTTPBody(), upTo: 1 << 16)
            )
            let id = request.path?.split(separator: "/").last.map(String.init) ?? ""
            let updated: BloomCapture? = state.withLock { state in
                guard let index = state.captures.firstIndex(where: { $0.id == id }) else { return nil }
                if let status = patch.status { state.captures[index].status = status }
                return state.captures[index]
            }
            guard let updated else { return (HTTPResponse(status: .notFound), nil) }
            return try json(updated)
        case "messages.send":
            let payload = try await JSONDecoder().decode(
                Components.Schemas.SendMessage.self,
                from: Data(collecting: body ?? HTTPBody(), upTo: 1 << 16)
            )
            return reply(to: payload.text)
        default:
            return (HTTPResponse(status: .notFound), nil)
        }
    }

    private func json(_ value: some Encodable) throws -> (HTTPResponse, HTTPBody?) {
        var response = HTTPResponse(status: .ok)
        response.headerFields[.contentType] = "application/json"
        return (response, HTTPBody(try JSONEncoder().encode(value)))
    }

    /// Streams a reply as Server-Sent Events, a beat apart, and records the turn.
    private func reply(to text: String) -> (HTTPResponse, HTTPBody?) {
        let now = BloomDate.format(.now)
        let (messageId, taskId) = state.withLock { state in
            state.counter += 1
            return ("demo-message-\(state.counter)", "demo-task-new-\(state.counter)")
        }
        let user = BloomMessage(
            id: "\(messageId)-user", threadId: Self.thread.id, role: .user,
            parts: [.text(.init(_type: .text, text: text))], runId: nil, createdAt: now
        )
        var events: [ChatStreamEvent] = [
            .messageStart(.init(_type: .messageStart, messageId: messageId, threadId: Self.thread.id)),
        ]
        var parts: [BloomMessagePart] = []
        let answer: String
        if text.hasPrefix("Add ") {
            let title = String(text.dropFirst(4)).trimmingCharacters(in: .punctuationCharacters.union(.whitespaces))
            let args: OpenAPIValueContainer = (try? OpenAPIValueContainer(unvalidatedValue: ["title": title])) ?? nil
            events += [
                .toolCall(.init(_type: .toolCall, messageId: messageId, toolCallId: "call-\(messageId)", name: "create_task", args: args)),
                .toolResult(.init(_type: .toolResult, messageId: messageId, toolCallId: "call-\(messageId)", name: "create_task", ok: true)),
                .tasksChanged(.init(_type: .tasksChanged)),
            ]
            parts += [
                .toolCall(.init(_type: .toolCall, id: "call-\(messageId)", name: "create_task", args: args)),
                .toolResult(.init(_type: .toolResult, toolCallId: "call-\(messageId)", name: "create_task", ok: true, result: nil)),
            ]
            state.withLock { state in
                state.tasks.append(BloomTask(
                    id: taskId, title: title, notes: nil, status: .inbox, due: nil, scheduledFor: nil, effort: nil,
                    energyKind: nil, area: nil, source: .agent, parentId: nil, completedAt: nil,
                    createdAt: now, updatedAt: now
                ))
            }
            answer = "Added “\(title)”."
        } else {
            answer = "Noted. I'm here when you need me."
        }
        let words = answer.split(separator: " ", omittingEmptySubsequences: false)
        for (index, word) in words.enumerated() {
            let delta = index == words.count - 1 ? String(word) : "\(word) "
            events.append(.textDelta(.init(_type: .textDelta, messageId: messageId, delta: delta)))
        }
        parts.append(.text(.init(_type: .text, text: answer)))
        let assistant = BloomMessage(
            id: messageId, threadId: Self.thread.id, role: .assistant, parts: parts, runId: nil, createdAt: now
        )
        events.append(.messageEnd(.init(_type: .messageEnd, message: assistant)))
        state.withLock { $0.messages += [user, assistant] }

        let frames = events.compactMap { event -> ArraySlice<UInt8>? in
            guard let data = try? JSONEncoder().encode(event), let line = String(data: data, encoding: .utf8) else { return nil }
            return ArraySlice(Array("data: \(line)\n\n".utf8))
        }
        let stream = AsyncStream<ArraySlice<UInt8>> { continuation in
            let task = Task {
                for frame in frames {
                    try? await Task.sleep(for: .milliseconds(120))
                    continuation.yield(frame)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
        var response = HTTPResponse(status: .ok)
        response.headerFields[.contentType] = "text/event-stream"
        return (response, HTTPBody(stream, length: .unknown, iterationBehavior: .single))
    }
}
#endif
