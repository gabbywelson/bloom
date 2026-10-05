import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization

/// A `ClientTransport` that answers from a closure and records every request.
final class FakeTransport: ClientTransport, Sendable {
    struct Recorded: Sendable {
        let request: HTTPRequest
        let body: String?
        let operationID: String
    }

    typealias Responder = @Sendable (HTTPRequest) -> (HTTPResponse.Status, String, String)

    private let responder: Responder
    private let log = Mutex<[Recorded]>([])

    /// `respond` returns status, content type and body for each request.
    init(_ respond: @escaping Responder) {
        responder = respond
    }

    var requests: [Recorded] { log.withLock { $0 } }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let bodyText: String? =
            if let body { try await String(collecting: body, upTo: 1 << 20) } else { nil }
        log.withLock { $0.append(Recorded(request: request, body: bodyText, operationID: operationID)) }
        let (status, contentType, text) = responder(request)
        var response = HTTPResponse(status: status)
        response.headerFields[.contentType] = contentType
        return (response, HTTPBody(text))
    }

    static func json(_ body: String, status: HTTPResponse.Status = .ok) -> Responder {
        { _ in (status, "application/json", body) }
    }
}

/// A transport whose every request fails like an offline network.
struct OfflineTransport: ClientTransport {
    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        throw URLError(.notConnectedToInternet)
    }
}
