import Foundation
import OpenAPIRuntime

/// Decodes the body of `POST /api/threads/{id}/messages` (Server-Sent Events)
/// into `ChatStreamEvent`s.
///
/// The request itself goes through the generated client; this only turns the
/// `text/event-stream` bytes into the generated `ChatStreamEvent` enum. SSE
/// framing is parsed by OpenAPIRuntime. The server writes one `data:` line of
/// JSON per event (fixtures in packages/api/test/fixtures/chat-stream).
///
/// Contract (ADR 0013): `message_start`, then tool and UI events, then
/// `text_delta`s, then `message_end`; or `error`, which is terminal and
/// carries text that is safe to show. The sequence finishes after the first
/// terminal event without waiting for the connection to close.
public enum ChatStream {
    /// Effect's reserved event name for a stream that failed on the server
    /// (`HttpApiBuilder`). Bloom's handler never fails its stream, so this
    /// only appears on a server defect.
    public static let failureEventName = "effect/http-api/stream/failure"

    /// Event types this client understands. Anything else is skipped, so a
    /// newer server can add events without breaking older apps.
    public static let knownTypes: Set<String> = [
        "message_start", "text_delta", "tool_call", "tool_result",
        "ui_component", "tasks_changed", "message_end", "error",
    ]

    public enum Failure: Error, Equatable, Sendable {
        /// The server reported a failure through the reserved failure event.
        case serverFailure
        /// The connection ended before `message_end` or `error`.
        case endedEarly
    }

    private struct TypeProbe: Decodable {
        let type: String
    }

    /// Events from raw SSE bytes. Throws `DecodingError` for a known event
    /// whose JSON does not match the contract.
    public static func events<Bytes>(
        from bytes: Bytes
    ) -> AsyncThrowingStream<ChatStreamEvent, any Error>
    where Bytes: AsyncSequence & Sendable, Bytes.Element == ArraySlice<UInt8> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let decoder = JSONDecoder()
                    for try await sse in bytes.asDecodedServerSentEvents() {
                        if sse.event == failureEventName { throw Failure.serverFailure }
                        guard let data = sse.data?.data(using: .utf8), !data.isEmpty else { continue }
                        let probe = try decoder.decode(TypeProbe.self, from: data)
                        guard knownTypes.contains(probe.type) else { continue }
                        let event = try decoder.decode(ChatStreamEvent.self, from: data)
                        continuation.yield(event)
                        if event.isTerminal {
                            continuation.finish()
                            return
                        }
                    }
                    throw Failure.endedEarly
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
