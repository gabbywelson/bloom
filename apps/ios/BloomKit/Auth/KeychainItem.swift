import Foundation
import Security

/// One generic-password Keychain entry holding a UTF-8 string.
///
/// Items are `AfterFirstUnlockThisDeviceOnly`: readable by extensions and
/// background work once the phone has been unlocked after boot, never synced
/// to iCloud or restored to another device.
public struct KeychainItem: Sendable {
    public struct Failure: Error, Equatable, Sendable {
        public let status: OSStatus
    }

    public let service: String
    public let account: String
    /// Shared access group for the app and its extensions; `nil` uses the app's default.
    public let accessGroup: String?

    public init(service: String, account: String, accessGroup: String? = nil) {
        self.service = service
        self.account = account
        self.accessGroup = accessGroup
    }

    private var query: [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }

    /// The stored string, or `nil` when absent (or unreadable).
    public func read() -> String? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Stores `value`, replacing any previous one.
    public func write(_ value: String) throws(Failure) {
        let data = Data(value.utf8)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            insert.merge(update) { _, new in new }
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw Failure(status: status) }
    }

    /// Removes the entry; succeeds when it was already absent.
    public func delete() throws(Failure) {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
    }
}
