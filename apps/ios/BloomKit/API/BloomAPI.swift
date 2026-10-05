import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

/// The Bloom API for the app: thin async wrappers over the generated client
/// (`Client`, from packages/api/openapi.json) that return wire models and
/// throw `BloomAPIError`. No request or response shape is written by hand.
///
/// Two generated clients share one configuration: plain calls use a session
/// with a 20 s idle timeout (the web's `REQUEST_TIMEOUT`); the chat stream uses
/// one that tolerates two minutes of silence while the model thinks (the
/// web's `STREAM_IDLE_TIMEOUT`; the server fails a stream silent for 60 s).
public struct BloomAPI: Sendable {
    public let serverURL: URL
    let client: Client
    let streamingClient: Client

    public static let requestTimeout: TimeInterval = 20
    public static let streamIdleTimeout: TimeInterval = 120

    /// - Parameters:
    ///   - serverURL: Origin of the Bloom server, e.g. `http://localhost:3000`.
    ///     Paths in the contract already start with `/api`.
    ///   - tokens: Source of the bearer token for every request.
    ///   - transport: Override for tests; defaults to URLSession.
    public init(serverURL: URL, tokens: any TokenProvider, transport: (any ClientTransport)? = nil) {
        self.serverURL = serverURL
        let middlewares: [any ClientMiddleware] = [BearerTokenMiddleware(tokens: tokens)]
        client = Client(
            serverURL: serverURL,
            transport: transport ?? Self.urlSessionTransport(idleTimeout: Self.requestTimeout, resourceTimeout: 60),
            middlewares: middlewares
        )
        streamingClient = Client(
            serverURL: serverURL,
            transport: transport
                ?? Self.urlSessionTransport(idleTimeout: Self.streamIdleTimeout, resourceTimeout: 15 * 60),
            middlewares: middlewares
        )
    }

    static func urlSessionTransport(idleTimeout: TimeInterval, resourceTimeout: TimeInterval) -> URLSessionTransport {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = idleTimeout
        configuration.timeoutIntervalForResource = resourceTimeout
        configuration.waitsForConnectivity = false
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        return URLSessionTransport(configuration: .init(session: URLSession(configuration: configuration)))
    }

    /// Runs a generated call and maps transport and decoding failures.
    private func call<T>(_ body: () async throws -> T) async throws(BloomAPIError) -> T {
        do {
            return try await body()
        } catch {
            throw BloomAPIError.from(error)
        }
    }

    // MARK: - Health and identity

    /// `GET /api/health` (no session needed).
    public func health() async throws(BloomAPIError) -> Components.Schemas.HealthStatus {
        let output = try await call { try await client.health_check() }
        switch output {
        case let .ok(ok): return try await call { try ok.body.json }
        case let .undocumented(status, _): throw .status(status)
        }
    }

    /// `GET /api/me`: who the session belongs to.
    public func me() async throws(BloomAPIError) -> BloomUser {
        let output = try await call { try await client.me_get() }
        switch output {
        case let .ok(ok): return try await call { try ok.body.json }
        case .unauthorized: throw .unauthorized
        case let .undocumented(status, _): throw .status(status)
        }
    }

    // MARK: - Threads and messages

    /// `GET /api/threads/main`: the single ongoing conversation.
    public func mainThread() async throws(BloomAPIError) -> BloomThread {
        let output = try await call { try await client.threads_main() }
        switch output {
        case let .ok(ok): return try await call { try ok.body.json }
        case .unauthorized: throw .unauthorized
        case let .undocumented(status, _): throw .status(status)
        }
    }

    /// `GET /api/threads/{id}/messages`: history, oldest first.
    public func messages(threadId: String, limit: Int? = nil) async throws(BloomAPIError) -> [BloomMessage] {
        let output = try await call {
            // The contract encodes the integer query parameter as a numeric string.
            try await client.threads_messages(path: .init(id: threadId), query: .init(limit: limit.map(String.init)))
        }
        switch output {
        case let .ok(ok): return try await call { try ok.body.json }
        case .unauthorized: throw .unauthorized
        case .notFound: throw .notFound
        case let .undocumented(status, _): throw .status(status)
        }
    }

    /// `POST /api/threads/{id}/messages`: sends the user's turn and streams
    /// the reply. Throws before streaming for HTTP errors (404, 401); the
    /// returned sequence throws for stream-level failures (see `ChatStream`).
    public func send(
        threadId: String,
        text: String
    ) async throws(BloomAPIError) -> AsyncThrowingStream<ChatStreamEvent, any Error> {
        let output = try await call {
            try await streamingClient.messages_send(path: .init(id: threadId), body: .json(.init(text: text)))
        }
        switch output {
        case let .ok(ok):
            let body = try await call { try ok.body.textEventStream }
            return ChatStream.events(from: body)
        case .unauthorized: throw .unauthorized
        case .notFound: throw .notFound
        case let .undocumented(status, _): throw .status(status)
        }
    }

    // MARK: - Tasks

    /// `GET /api/tasks`, optionally filtered by status; creation order.
    public func tasks(status: [BloomTaskStatus]? = nil) async throws(BloomAPIError) -> [BloomTask] {
        let output = try await call { try await client.tasks_list(query: .init(status: status)) }
        switch output {
        case let .ok(ok): return try await call { try ok.body.json }
        case .unauthorized: throw .unauthorized
        case let .undocumented(status, _): throw .status(status)
        }
    }

    /// `POST /api/tasks`.
    public func createTask(_ input: BloomTaskCreate) async throws(BloomAPIError) -> BloomTask {
        let output = try await call { try await client.tasks_create(body: .json(input)) }
        switch output {
        case let .ok(ok): return try await call { try ok.body.json }
        case .unauthorized: throw .unauthorized
        case let .undocumented(status, _): throw .status(status)
        }
    }

    /// `POST /api/tasks/{id}/complete`.
    public func completeTask(id: String) async throws(BloomAPIError) -> BloomTask {
        let output = try await call { try await client.tasks_complete(path: .init(id: id)) }
        switch output {
        case let .ok(ok): return try await call { try ok.body.json }
        case .unauthorized: throw .unauthorized
        case .notFound: throw .notFound
        case let .undocumented(status, _): throw .status(status)
        }
    }

    // MARK: - Captures

    /// `POST /api/captures`: files raw input for triage (ADR 0019).
    public func createCapture(_ draft: CaptureDraft) async throws(BloomAPIError) -> BloomCapture {
        let output = try await call {
            try await client.captures_create(body: .json(.init(kind: draft.kind, payload: draft.payload)))
        }
        switch output {
        case let .ok(ok): return try await call { try ok.body.json }
        case .unauthorized: throw .unauthorized
        case let .undocumented(status, _): throw .status(status)
        }
    }

    /// `GET /api/captures`, optionally filtered by status; creation order.
    public func captures(status: [BloomCaptureStatus]? = nil) async throws(BloomAPIError) -> [BloomCapture] {
        let output = try await call { try await client.captures_list(query: .init(status: status)) }
        switch output {
        case let .ok(ok): return try await call { try ok.body.json }
        case .unauthorized: throw .unauthorized
        case let .undocumented(status, _): throw .status(status)
        }
    }

    /// `PATCH /api/captures/{id}`: triage (status, routedTo, transcript).
    public func updateCapture(
        id: String,
        _ patch: Components.Schemas.CaptureUpdate
    ) async throws(BloomAPIError) -> BloomCapture {
        let output = try await call { try await client.captures_update(path: .init(id: id), body: .json(patch)) }
        switch output {
        case let .ok(ok): return try await call { try ok.body.json }
        case .unauthorized: throw .unauthorized
        case .notFound: throw .notFound
        case let .undocumented(status, _): throw .status(status)
        }
    }

    // MARK: - Events

    /// `POST /api/events`: idempotent by `dedupeKey` (a repeat answers `.duplicate`).
    public func ingestEvent(
        _ input: Components.Schemas.EventIngest
    ) async throws(BloomAPIError) -> Components.Schemas.IngestResult {
        let output = try await call { try await client.events_ingest(body: .json(input)) }
        switch output {
        case let .ok(ok): return try await call { try ok.body.json }
        case .unauthorized: throw .unauthorized
        case .badRequest: throw .badRequest
        case let .undocumented(status, _): throw .status(status)
        }
    }
}
