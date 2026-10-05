import BloomKit
import Foundation
import Testing

/// Mirrors apps/web/src/lib/chat.test.ts so both clients fold the stream the same way.
@Suite("Chat transcript reducer")
struct ChatTranscriptTests {
    static let assistantId = "019a0000-0000-7000-8000-000000000002"
    static let threadId = "019a0000-0000-7000-8000-00000000aaaa"
    static let now = Date(timeIntervalSince1970: 1_791_234_000)

    let user = ChatMessage(
        id: "local-1",
        role: .user,
        parts: [.text(.init(_type: .text, text: "Please add a task to water the plants tomorrow"))],
        createdAt: now
    )

    private func event(_ json: String) -> ChatStreamEvent {
        // Test fixtures are literals; a typo should fail loudly.
        try! JSONDecoder().decode(ChatStreamEvent.self, from: Data(json.utf8))
    }

    private var start: ChatStreamEvent {
        event(#"{"type":"message_start","messageId":"\#(Self.assistantId)","threadId":"\#(Self.threadId)"}"#)
    }

    private func delta(_ text: String, id: String = assistantId) -> ChatStreamEvent {
        event(#"{"type":"text_delta","messageId":"\#(id)","delta":"\#(text)"}"#)
    }

    private func toolCall(_ id: String, _ name: String) -> ChatStreamEvent {
        event(#"{"type":"tool_call","messageId":"\#(Self.assistantId)","toolCallId":"\#(id)","name":"\#(name)","args":{"title":"Water the plants"}}"#)
    }

    private func toolResult(_ id: String, _ name: String) -> ChatStreamEvent {
        event(#"{"type":"tool_result","messageId":"\#(Self.assistantId)","toolCallId":"\#(id)","name":"\#(name)","ok":true}"#)
    }

    private var persistedEnd: ChatStreamEvent {
        event(#"""
            {"type":"message_end","message":{"id":"\#(Self.assistantId)","threadId":"\#(Self.threadId)","role":"assistant",
             "parts":[{"type":"tool_call","id":"call-1","name":"create_task","args":{"title":"Water the plants"}},
                      {"type":"tool_result","toolCallId":"call-1","name":"create_task","ok":true,"result":{"id":"t1"}},
                      {"type":"text","text":"Done. I added it for tomorrow."}],
             "runId":null,"createdAt":"2026-10-04T09:00:02.000Z"}}
            """#)
    }

    private func fold(_ events: [ChatStreamEvent], from initial: [ChatMessage]? = nil) -> [ChatMessage] {
        events.reduce(initial ?? [user]) { ChatTranscript.apply($1, to: $0, now: Self.now) }
    }

    private func kinds(_ message: ChatMessage?) -> [String] {
        (message?.parts ?? []).map { part in
            switch part {
            case .text: "text"
            case .image: "image"
            case .toolCall: "tool_call"
            case .toolResult: "tool_result"
            case .uiComponent: "ui_component"
            }
        }
    }

    @Test("builds the assistant reply incrementally in the ADR 0013 order")
    func incremental() {
        let afterStart = fold([start])
        #expect(afterStart.count == 2)
        #expect(afterStart[1].id == Self.assistantId)
        #expect(afterStart[1].role == .assistant)
        #expect(afterStart[1].parts.isEmpty)

        let afterTools = fold([toolCall("call-1", "create_task"), toolResult("call-1", "create_task"), event(#"{"type":"tasks_changed"}"#)], from: afterStart)
        #expect(kinds(afterTools[1]) == ["tool_call", "tool_result"])

        let afterText = fold([delta("Done. "), delta("I added it"), delta(" for tomorrow.")], from: afterTools)
        guard case let .text(last)? = afterText[1].parts.last else {
            Issue.record("expected a trailing text part")
            return
        }
        #expect(last.text == "Done. I added it for tomorrow.")
        // Deltas accumulate into one text part; they never create one part per token.
        #expect(afterText[1].parts.count == 3)

        let final = fold([persistedEnd], from: afterText)
        #expect(final.count == 2)
        #expect(final[0] == user)
        #expect(final[1].createdAt == BloomDate.parse("2026-10-04T09:00:02.000Z"))
        guard case let .toolResult(result) = final[1].parts[1] else {
            Issue.record("expected the persisted tool result")
            return
        }
        #expect(result.result.value != nil)
    }

    @Test("starts a new text part when text follows a tool round")
    func textAfterTools() {
        let messages = fold([start, delta("Let me check."), toolCall("c", "list_tasks"), toolResult("c", "list_tasks"), delta("Three things.")])
        #expect(kinds(messages[1]) == ["text", "tool_call", "tool_result", "text"])
    }

    @Test("ignores events for unknown messages and duplicate starts")
    func unknownAndDuplicate() {
        let messages = fold([start, start, delta("lost", id: "019a0000-0000-7000-8000-000000000009")])
        #expect(messages.count == 2)
        #expect(messages[1].parts.isEmpty)
    }

    @Test("appends the final message when message_end arrives without a start")
    func endWithoutStart() {
        let messages = fold([persistedEnd])
        #expect(messages.count == 2)
        #expect(messages[0] == user)
        #expect(messages[1].id == Self.assistantId)
    }

    @Test("drops an empty assistant bubble on error but keeps partial output")
    func errorHandling() {
        let failure = event(#"{"type":"error","message":"Something went wrong on my side."}"#)
        #expect(fold([start, failure]) == [user])

        let partial = fold([start, delta("I started to"), failure])
        #expect(partial.count == 2)
        #expect(partial[1].parts == [.text(.init(_type: .text, text: "I started to"))])
    }

    @Test("the optimistic user turn is local and carries the text")
    func localUser() {
        let message = ChatMessage.localUser("hi", at: Self.now)
        #expect(message.id.hasPrefix("local-"))
        #expect(message.role == .user)
        #expect(message.parts == [.text(.init(_type: .text, text: "hi"))])
    }
}
