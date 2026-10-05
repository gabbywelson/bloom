import Foundation

/// The signed-in session: which server, the bearer token, and who it belongs to.
///
/// The token lives in the Keychain; the server origin and the cached user
/// (shown while offline) live in `UserDefaults`. Both can be pointed at an
/// app group so extensions share the session.
public struct SessionStore: TokenProvider, @unchecked Sendable {
    // `UserDefaults` is documented as thread-safe; it is not annotated Sendable.
    let keychain: KeychainItem
    let defaults: UserDefaults

    static let serverKey = "bloom.session.server"
    static let userKey = "bloom.session.user"

    public init(keychain: KeychainItem, defaults: UserDefaults) {
        self.keychain = keychain
        self.defaults = defaults
    }

    /// Info.plist key naming the Keychain access group shared with extensions
    /// (`$(AppIdentifierPrefix)dev.bloom.shared`).
    public static let keychainGroupKey = "BloomKeychainGroup"
    /// Info.plist key naming the app group whose defaults hold the server origin.
    public static let appGroupKey = "BloomAppGroup"

    /// The session shared by the app and its extensions (share sheet, widget,
    /// intents): the Keychain access group and app group come from the
    /// running bundle's Info.plist, so each target reads the same entries.
    /// Without those keys (unit tests of other bundles) it falls back to the
    /// process's own Keychain and standard defaults.
    public static var shared: SessionStore { make(bundle: .main) }

    static func make(bundle: Bundle) -> SessionStore {
        let info = bundle.infoDictionary ?? [:]
        let group = (info[keychainGroupKey] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let suite = (info[appGroupKey] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return SessionStore(
            keychain: KeychainItem(service: "dev.bloom.session", account: "bearer", accessGroup: group),
            defaults: suite.flatMap(UserDefaults.init(suiteName:)) ?? .standard
        )
    }

    public var serverURL: URL? { defaults.url(forKey: Self.serverKey) }

    public var token: String? { keychain.read() }

    /// The user the session belonged to when last confirmed.
    public var cachedUser: BloomUser? {
        defaults.data(forKey: Self.userKey).flatMap { try? JSONDecoder().decode(BloomUser.self, from: $0) }
    }

    /// Signed in means a server and a token are both present.
    public var isSignedIn: Bool { serverURL != nil && token != nil }

    public func currentToken() async -> String? { keychain.read() }

    public func save(server: URL, token: String, user: BloomUser) throws(KeychainItem.Failure) {
        try keychain.write(token)
        defaults.set(server, forKey: Self.serverKey)
        remember(user)
    }

    public func remember(_ user: BloomUser) {
        if let data = try? JSONEncoder().encode(user) { defaults.set(data, forKey: Self.userKey) }
    }

    /// Forgets the token and the user. The server origin stays as the default for next time.
    public func clear() {
        try? keychain.delete()
        defaults.removeObject(forKey: Self.userKey)
    }
}
