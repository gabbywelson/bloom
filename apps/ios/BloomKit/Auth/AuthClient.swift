import Foundation

/// The two Better Auth calls the app makes. They are hand-written because
/// `/api/auth/*` belongs to Better Auth and is not part of the HttpApi
/// contract (ADR 0007's one exception; ADR 0018).
public enum AuthClient {
    public enum Failure: Error, Equatable, Sendable {
        /// The link was already used or has expired (15 minutes).
        case linkExpiredOrUsed
        /// The server could not be reached.
        case unreachable
        /// Anything else the server answered.
        case unexpected(status: Int)

        public var message: String {
            switch self {
            case .linkExpiredOrUsed:
                "That link has already been used or has expired. Ask for a fresh one with bun run auth:link --ios."
            case .unreachable:
                "Bloom can't reach the server at that address."
            case .unexpected:
                "Signing in didn't work. Give it a moment and try again."
            }
        }
    }

    /// Response header the `bearer` plugin sets when a request creates a session.
    static let tokenHeader = "set-auth-token"

    /// Opens the magic link the way a browser would, minus the redirect, and
    /// returns the session token Better Auth hands back in `set-auth-token`.
    /// The token is never logged.
    public static func exchange(
        _ link: SignInLink,
        session: URLSession = .shared
    ) async throws(Failure) -> String {
        var request = URLRequest(url: link.verifyURL, timeoutInterval: BloomAPI.requestTimeout)
        request.httpShouldHandleCookies = false
        let response: URLResponse
        do {
            (_, response) = try await session.data(for: request, delegate: NoRedirects())
        } catch {
            throw .unreachable
        }
        guard let http = response as? HTTPURLResponse else { throw .unexpected(status: 0) }
        if let token = http.value(forHTTPHeaderField: tokenHeader), !token.isEmpty {
            return token
        }
        // Better Auth redirects a spent or expired link to its error page.
        if (300..<400).contains(http.statusCode) { throw .linkExpiredOrUsed }
        throw .unexpected(status: http.statusCode)
    }

    /// Revokes the session on the server. Best effort: signing out locally
    /// must not depend on the network.
    public static func signOut(server: URL, token: String, session: URLSession = .shared) async {
        var request = URLRequest(
            url: server.appending(path: "api/auth/sign-out"),
            timeoutInterval: BloomAPI.requestTimeout
        )
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        _ = try? await session.data(for: request)
    }
}

/// Stops URLSession from following the magic link's redirect to the web app.
/// (The completion-handler form on purpose: Swift 6.4 crashes in SILGen on
/// the `async` variant of this delegate method under approachable concurrency.)
private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
