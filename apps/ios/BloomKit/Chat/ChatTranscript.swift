import Foundation

/// A message as the chat view holds it: a persisted `Message` from the API,
/// or one that so far only exists locally (the optimistic user turn, or the
/// assistant reply while it streams).
public struct ChatMessage: Identifiable, Equatable, Sendable {
    public let id: String
    public let role: BloomMessageRole
    public var parts: [BloomMessagePart]
    public let createdAt: Date
    /// The run's trace, once persisted (ADR 0024).
    public let traceId: String?

    public init(id: String, role: BloomMessageRole, parts: [BloomMessagePart], createdAt: Date, traceId: String? = nil) {
        self.id = id
        self.role = role
        self.parts = parts
        self.createdAt = createdAt
        self.traceId = traceId
    }

    public init(_ message: BloomMessage) {
        self.init(
            id: message.id,
            role: message.role,
            parts: message.parts,
            createdAt: message.createdDate ?? .distantPast,
            traceId: message.traceId
        )
    }

    /// The optimistic user turn shown before the server has it.
    public static func localUser(_ text: String, at date: Date = .now) -> ChatMessage {
        ChatMessage(
            id: "local-\(UUID().uuidString)",
            role: .user,
            parts: [.text(.init(_type: .text, text: text))],
            createdAt: date
        )
    }
}

/// Pure reducer for the chat SSE stream (ADR 0013), the Swift twin of the
/// web's `apps/web/src/lib/chat.ts`:
///
///     message_start → [tool_call, tool_result, ui_component, tasks_changed]* → text_delta* → message_end
///     ... or → error (terminal)
///
/// Side effects (`tasks_changed` refetch, surfacing `error` text) are the
/// caller's job.
public enum ChatTranscript {
    /// Applies one stream event. `now` stamps the assistant message created on
    /// `message_start`; `message_end` replaces it with the persisted one.
    public static func apply(
        _ event: ChatStreamEvent,
        to messages: [ChatMessage],
        now: Date = .now
    ) -> [ChatMessage] {
        switch event {
        case let .messageStart(start):
            guard !messages.contains(where: { $0.id == start.messageId }) else { return messages }
            return messages + [ChatMessage(id: start.messageId, role: .assistant, parts: [], createdAt: now)]

        case let .textDelta(delta):
            return update(messages, id: delta.messageId) { appendText($0, delta.delta) }

        case let .toolCall(call):
            return update(messages, id: call.messageId) { message in
                var message = message
                message.parts.append(.toolCall(.init(_type: .toolCall, id: call.toolCallId, name: call.name, args: call.args)))
                return message
            }

        case let .toolResult(result):
            // The event carries no payload; the full result arrives with `message_end`.
            return update(messages, id: result.messageId) { message in
                var message = message
                message.parts.append(.toolResult(.init(
                    _type: .toolResult,
                    toolCallId: result.toolCallId,
                    name: result.name,
                    ok: result.ok,
                    result: nil
                )))
                return message
            }

        case let .uiComponent(ui):
            return update(messages, id: ui.messageId) { message in
                var message = message
                message.parts.append(.uiComponent(.init(_type: .uiComponent, component: ui.component)))
                return message
            }

        case .tasksChanged:
            return messages

        case let .messageEnd(end):
            let final = ChatMessage(end.message)
            guard let index = messages.firstIndex(where: { $0.id == final.id }) else { return messages + [final] }
            var next = messages
            next[index] = final
            return next

        case .error:
            // A reply that failed before producing anything leaves no empty bubble behind.
            return messages.filter { !($0.role == .assistant && $0.parts.isEmpty) }
        }
    }

    private static func update(
        _ messages: [ChatMessage],
        id: String,
        _ change: (ChatMessage) -> ChatMessage
    ) -> [ChatMessage] {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return messages }
        var next = messages
        next[index] = change(messages[index])
        return next
    }

    /// Appends to the trailing text part, or starts a new one after a tool/ui part.
    private static func appendText(_ message: ChatMessage, _ delta: String) -> ChatMessage {
        var message = message
        if case let .text(last)? = message.parts.last {
            message.parts[message.parts.count - 1] = .text(.init(_type: .text, text: last.text + delta))
        } else {
            message.parts.append(.text(.init(_type: .text, text: delta)))
        }
        return message
    }
}
