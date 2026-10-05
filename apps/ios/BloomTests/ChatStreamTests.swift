import BloomKit
import Foundation
import Testing

/// Decoding the chat SSE stream (ADR 0013) from recorded server output.
@Suite("Chat stream decoding")
struct ChatStreamTests {
    private func collect(
        _ bytes: AsyncStream<ArraySlice<UInt8>>
    ) async throws -> [ChatStreamEvent] {
        var events: [ChatStreamEvent] = []
        for try await event in ChatStream.events(from: bytes) {
            events.append(event)
        }
        return events
    }

    private func kinds(_ events: [ChatStreamEvent]) -> [String] {
        events.map { event in
            switch event {
            case .messageStart: "message_start"
            case .textDelta: "text_delta"
            case .toolCall: "tool_call"
            case .toolResult: "tool_result"
            case .uiComponent: "ui_component"
            case .tasksChanged: "tasks_changed"
            case .messageEnd: "message_end"
            case .error: "error"
            }
        }
    }

    @Test("a plain reply: start, deltas, end with the persisted message")
    func plainReply() async throws {
        let events = try await collect(Fixtures.chunks(Fixtures.chatStream("plain-reply"), size: 1 << 16))
        #expect(kinds(events) == ["message_start", "text_delta", "text_delta", "message_end"])
        guard case let .messageEnd(end) = events.last else {
            Issue.record("expected message_end last")
            return
        }
        #expect(end.message.role == .assistant)
        #expect(end.message.text == "Morning. Nothing urgent today.")
        #expect(end.message.createdDate == BloomDate.parse("2026-10-05T07:30:00.000Z"))
    }

    @Test("a tool round: tool parts and tasks_changed come before the text")
    func toolRound() async throws {
        let events = try await collect(Fixtures.chunks(Fixtures.chatStream("tool-round"), size: 1 << 16))
        #expect(kinds(events) == [
            "message_start", "tool_call", "tool_result", "tasks_changed",
            "text_delta", "text_delta", "message_end",
        ])
        guard case let .toolCall(call) = events[1], case let .toolResult(result) = events[2] else {
            Issue.record("expected tool_call then tool_result")
            return
        }
        #expect(call.name == "create_task")
        #expect(call.toolCallId == result.toolCallId)
        #expect(result.ok)
        guard case let .messageEnd(end) = events.last else {
            Issue.record("expected message_end last")
            return
        }
        let cards = end.message.parts.compactMap { part -> Components.Schemas.TaskCard? in
            if case let .uiComponent(ui) = part, case let .taskCard(card) = ui.component { card } else { nil }
        }
        #expect(cards.map(\.title) == ["Water the ferns"])
        #expect(end.message.text == "Added “Water the ferns”.")
    }

    @Test("error is terminal and carries calm text; the stream finishes cleanly")
    func modelError() async throws {
        let events = try await collect(Fixtures.chunks(Fixtures.chatStream("model-error"), size: 1 << 16))
        #expect(kinds(events) == ["message_start", "text_delta", "error"])
        guard case let .error(error) = events.last else {
            Issue.record("expected error last")
            return
        }
        #expect(error.message.hasPrefix("I couldn't reach my thinking"))
    }

    @Test("events survive any chunking of the bytes", arguments: [1, 2, 7, 64, 300])
    func chunking(size: Int) async throws {
        let data = try Fixtures.chatStream("tool-round")
        let whole = try await collect(Fixtures.chunks(data, size: 1 << 20))
        let chunked = try await collect(Fixtures.chunks(data, size: size))
        #expect(chunked == whole)
        #expect(chunked.count == 7)
    }

    @Test("CRLF line endings are accepted")
    func crlf() async throws {
        let text = try #require(String(data: Fixtures.chatStream("plain-reply"), encoding: .utf8))
        let events = try await collect(Fixtures.chunks(text.replacingOccurrences(of: "\n", with: "\r\n")))
        #expect(kinds(events) == ["message_start", "text_delta", "text_delta", "message_end"])
    }

    @Test("the server's reserved failure event fails the sequence")
    func serverFailure() async throws {
        let text = """
            data: {"type":"message_start","messageId":"m","threadId":"t"}

            event: effect/http-api/stream/failure
            data: [{"_tag":"Die","defect":"boom"}]


            """
        await #expect(throws: ChatStream.Failure.serverFailure) {
            _ = try await collect(Fixtures.chunks(text))
        }
    }

    @Test("unknown event types are skipped, so a newer server does not break the app")
    func unknownEventsSkipped() async throws {
        let text = """
            data: {"type":"message_start","messageId":"m","threadId":"t"}

            data: {"type":"reasoning_delta","messageId":"m","delta":"hmm"}

            data: {"type":"error","message":"Not now."}


            """
        let events = try await collect(Fixtures.chunks(text))
        #expect(kinds(events) == ["message_start", "error"])
    }

    @Test("a stream that ends without message_end or error is a failure")
    func endedEarly() async throws {
        let text = """
            data: {"type":"message_start","messageId":"m","threadId":"t"}

            data: {"type":"text_delta","messageId":"m","delta":"Hel"}


            """
        await #expect(throws: ChatStream.Failure.endedEarly) {
            _ = try await collect(Fixtures.chunks(text))
        }
    }

    @Test("a known event that breaks the contract is a decoding error")
    func malformedKnownEvent() async throws {
        let text = """
            data: {"type":"text_delta","messageId":"m"}


            """
        await #expect(throws: DecodingError.self) {
            _ = try await collect(Fixtures.chunks(text))
        }
    }

    @Test("nothing after a terminal event is read")
    func stopsAtTerminal() async throws {
        let text = """
            data: {"type":"error","message":"Not now."}

            data: this is not json


            """
        let events = try await collect(Fixtures.chunks(text))
        #expect(kinds(events) == ["error"])
    }
}
