import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Where the API client gets the session token from (the Keychain in the app).
public protocol TokenProvider: Sendable {
    func currentToken() async -> String?
}

/// A fixed token (tests, previews).
public struct StaticTokenProvider: TokenProvider {
    let token: String?
    public init(_ token: String?) { self.token = token }
    public func currentToken() async -> String? { token }
}

/// Sends `Authorization: Bearer <token>` on every request when a token exists
/// (ADR 0018). The server's Better Auth `bearer` plugin turns it back into a
/// session; the web keeps using its cookie.
struct BearerTokenMiddleware: ClientMiddleware {
    let tokens: any TokenProvider

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @concurrent @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        if let token = await tokens.currentToken() {
            request.headerFields[.authorization] = "Bearer \(token)"
        }
        return try await next(request, body, baseURL)
    }
}
