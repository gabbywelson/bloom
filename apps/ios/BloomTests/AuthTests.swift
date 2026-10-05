import BloomKit
import Foundation
import Testing

@Suite("Sign-in links")
struct SignInLinkTests {
    static let magic =
        "http://localhost:5173/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fpasskeys&errorCallbackURL=%2Flogin"

    @Test("a pasted magic link is accepted and names its server")
    func pastedLink() throws {
        let link = try #require(SignInLink("  \(Self.magic)\n"))
        #expect(link.verifyURL.absoluteString == Self.magic)
        #expect(link.server.absoluteString == "http://localhost:5173")
    }

    @Test("the bloom:// deep link from auth:link --ios is accepted")
    func deepLink() throws {
        var components = URLComponents(string: "bloom://sign-in")!
        components.queryItems = [URLQueryItem(name: "link", value: Self.magic)]
        let url = try #require(components.url)
        let link = try #require(SignInLink(url: url))
        #expect(link.verifyURL.absoluteString == Self.magic)
        #expect(SignInLink(url.absoluteString) == link)
    }

    @Test("anything else is refused", arguments: [
        "",
        "hello",
        "bloom://sign-in",
        "bloom://elsewhere?link=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fmagic-link%2Fverify%3Ftoken%3Dx",
        "http://localhost:3000/api/auth/magic-link/verify",
        "http://localhost:3000/api/auth/magic-link/verify?token=",
        "http://localhost:3000/api/tasks?token=abc",
        "ftp://localhost/api/auth/magic-link/verify?token=abc",
    ])
    func refused(text: String) {
        #expect(SignInLink(text) == nil)
    }

    @Test("the server can be overridden, keeping path and token")
    func serverOverride() throws {
        let link = try #require(SignInLink(Self.magic))
        let moved = try #require(link.with(server: URL(string: "https://mac.tail1234.ts.net")!))
        #expect(moved.server.absoluteString == "https://mac.tail1234.ts.net")
        #expect(moved.verifyURL.path() == SignInLink.verifyPath)
        #expect(moved.verifyURL.query()?.contains("token=abc123") == true)
        let local = try #require(link.with(server: URL(string: "http://localhost:3000")!))
        #expect(local.server.absoluteString == "http://localhost:3000")
    }
}

@Suite("Session store", .serialized)
struct SessionStoreTests {
    private func store() -> SessionStore {
        let suite = "bloom.tests.\(UUID().uuidString)"
        return SessionStore(
            keychain: KeychainItem(service: "dev.bloom.tests.\(UUID().uuidString)", account: "bearer"),
            defaults: UserDefaults(suiteName: suite)!
        )
    }

    @Test("saves, reads and clears the session; the server is remembered")
    func roundTrip() async throws {
        let session = store()
        #expect(!session.isSignedIn)
        #expect(await session.currentToken() == nil)

        let server = URL(string: "http://localhost:3000")!
        let user = BloomUser(id: "u1", email: "owner@example.com", name: "Owner")
        try session.save(server: server, token: "tok.sig", user: user)
        #expect(session.isSignedIn)
        #expect(await session.currentToken() == "tok.sig")
        #expect(session.serverURL == server)
        #expect(session.cachedUser == user)

        try session.save(server: server, token: "tok2.sig", user: user)
        #expect(session.token == "tok2.sig")

        session.clear()
        #expect(!session.isSignedIn)
        #expect(session.token == nil)
        #expect(session.cachedUser == nil)
        #expect(session.serverURL == server)
    }
}

/// Answers every request from a closure; installed per URLSession.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var respond: (URLRequest) -> (Int, [String: String]) = { _ in (500, [:]) }
    nonisolated(unsafe) static var seen: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.seen.append(request)
        let (status, headers) = Self.respond(request)
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)
        else { return }
        if (300..<400).contains(status), let location = headers["Location"], let next = URL(string: location) {
            client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: next), redirectResponse: response)
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data())
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}

@Suite("Magic-link exchange", .serialized)
struct AuthClientTests {
    let link = SignInLink(SignInLinkTests.magic)!

    @Test("returns set-auth-token and does not follow the redirect to the web app")
    func exchange() async throws {
        StubURLProtocol.seen = []
        StubURLProtocol.respond = { _ in
            (302, ["Location": "http://localhost:5173/passkeys", "set-auth-token": "tok.sig"])
        }
        let token = try await AuthClient.exchange(link, session: StubURLProtocol.session())
        #expect(token == "tok.sig")
        #expect(StubURLProtocol.seen.map { $0.url?.path() } == [SignInLink.verifyPath])
    }

    @Test("a spent link (redirect without a token) is reported calmly")
    func spentLink() async throws {
        StubURLProtocol.respond = { _ in (302, ["Location": "http://localhost:5173/login?error=INVALID_TOKEN"]) }
        await #expect(throws: AuthClient.Failure.linkExpiredOrUsed) {
            _ = try await AuthClient.exchange(link, session: StubURLProtocol.session())
        }
    }

    @Test("other answers are unexpected")
    func unexpected() async throws {
        StubURLProtocol.respond = { _ in (500, [:]) }
        await #expect(throws: AuthClient.Failure.unexpected(status: 500)) {
            _ = try await AuthClient.exchange(link, session: StubURLProtocol.session())
        }
    }
}
