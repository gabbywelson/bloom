import BloomKit
import Foundation
import Observation

/// App-wide state: who is signed in, and the API client for their server.
@Observable
final class AppModel {
    enum Phase: Equatable {
        case signedOut
        case signingIn
        case signedIn(BloomUser)
    }

    private(set) var phase: Phase
    /// Calm text for the last sign-in failure.
    var signInError: String?
    /// The server the sign-in screen suggests (last used, else localhost).
    private(set) var suggestedServer: String

    private(set) var api: BloomAPI?
    let session: SessionStore

    static let defaultServer = "http://localhost:3000"

    init(session: SessionStore = .standard) {
        self.session = session
        if ProcessInfo.processInfo.arguments.contains("-BloomResetSession") {
            session.clear()
        }
        suggestedServer = session.serverURL?.absoluteString ?? Self.defaultServer
        // Optimistic: a stored session is signed in until the server says otherwise,
        // so the app opens instantly and works with cached data while offline.
        if let server = session.serverURL, session.token != nil {
            api = BloomAPI(serverURL: server, tokens: session)
            phase = .signedIn(
                session.cachedUser ?? BloomUser(id: "", email: "", name: "")
            )
        } else {
            phase = .signedOut
        }
    }

    /// Confirms a stored session with `GET /api/me`. Only a 401 signs out;
    /// being offline keeps the session.
    func refreshUser() async {
        guard let api, case .signedIn = phase else { return }
        do {
            let user = try await api.me()
            session.remember(user)
            phase = .signedIn(user)
        } catch .unauthorized {
            signOutLocally()
        } catch {
            // Offline or a server hiccup: keep going with what we have.
        }
    }

    /// Signs in with pasted text or an opened `bloom://` link. `serverOverride`
    /// replaces the link's origin (the phone reaches the server by another name).
    func signIn(with text: String, serverOverride: String? = nil) async {
        signInError = nil
        guard var link = SignInLink(text) else {
            signInError = "That doesn't look like a Bloom sign-in link. Run bun run auth:link --ios on the server and paste what it prints."
            return
        }
        if let serverOverride, !serverOverride.isEmpty {
            guard let server = URL(string: serverOverride), let moved = link.with(server: server) else {
                signInError = "The server address should look like http://localhost:3000."
                return
            }
            link = moved
        }
        phase = .signingIn
        do {
            let token = try await AuthClient.exchange(link)
            let api = BloomAPI(serverURL: link.server, tokens: StaticTokenProvider(token))
            let user = try await api.me()
            try session.save(server: link.server, token: token, user: user)
            self.api = BloomAPI(serverURL: link.server, tokens: session)
            suggestedServer = link.server.absoluteString
            phase = .signedIn(user)
        } catch let failure as AuthClient.Failure {
            fail(failure.message)
        } catch let failure as BloomAPIError {
            fail(failure.message)
        } catch {
            fail("Signing in didn't work. Give it a moment and try again.")
        }
    }

    private func fail(_ message: String) {
        signInError = message
        phase = .signedOut
    }

    /// `bloom://sign-in?link=…` opened from outside the app.
    func handle(url: URL) {
        guard url.scheme == "bloom", url.host() == "sign-in" else { return }
        Task { await signIn(with: url.absoluteString) }
    }

    /// Revokes the session on the server (best effort) and forgets it here.
    func signOut() async {
        if let server = session.serverURL, let token = session.token {
            await AuthClient.signOut(server: server, token: token)
        }
        signOutLocally()
    }

    /// Any feature that gets a 401 calls this.
    func signOutLocally() {
        session.clear()
        api = nil
        phase = .signedOut
    }
}
