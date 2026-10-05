import Foundation

/// A one-time sign-in link from `bun run auth:link` (ADR 0018), in either form:
///
/// - the magic link itself, pasted:
///   `http://localhost:5173/api/auth/magic-link/verify?token=…&callbackURL=…`
/// - the app's deep link from `bun run auth:link --ios`:
///   `bloom://sign-in?link=<the magic link, percent-encoded>`
///
/// The link's origin is the server the app will talk to.
public struct SignInLink: Equatable, Sendable {
    public static let verifyPath = "/api/auth/magic-link/verify"

    /// The magic link to open (always http or https).
    public let verifyURL: URL

    /// Origin of the server, e.g. `http://localhost:3000`.
    public var server: URL {
        var components = URLComponents()
        components.scheme = verifyURL.scheme
        components.host = verifyURL.host()
        components.port = verifyURL.port
        // A scheme and a host always make a valid URL; fall back to the link itself.
        return components.url ?? verifyURL
    }

    /// Parses pasted text or an opened URL; `nil` when it is not a sign-in link.
    public init?(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed) else { return nil }
        self.init(url: url)
    }

    public init?(url: URL) {
        if url.scheme == "bloom" {
            guard url.host() == "sign-in",
                  let inner = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                      .queryItems?.first(where: { $0.name == "link" })?.value,
                  let innerURL = URL(string: inner)
            else { return nil }
            self.init(verify: innerURL)
        } else {
            self.init(verify: url)
        }
    }

    private init?(verify url: URL) {
        guard let scheme = url.scheme, scheme == "http" || scheme == "https",
              url.host() != nil,
              url.path() == Self.verifyPath,
              let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                  .queryItems?.first(where: { $0.name == "token" })?.value,
              !token.isEmpty
        else { return nil }
        verifyURL = url
    }

    /// The same link against another origin (the user overrode the server).
    public func with(server: URL) -> SignInLink? {
        guard var components = URLComponents(url: verifyURL, resolvingAgainstBaseURL: false) else { return nil }
        components.scheme = server.scheme
        components.host = server.host()
        components.port = server.port
        guard let url = components.url else { return nil }
        return SignInLink(verify: url)
    }
}
