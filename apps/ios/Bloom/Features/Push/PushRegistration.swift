import BloomKit
import Foundation
import Observation
import UIKit
import UserNotifications

/// Push groundwork (ADR 0023), behind the "Labs → Register for push" flag:
/// asks for notification permission, registers with APNs, and stores the
/// token on the server (`POST /api/devices`). Nothing sends pushes yet.
@Observable
final class PushRegistration {
    enum Status: Equatable {
        case off
        case requesting
        case denied
        case registered(deviceId: String)
        case failed(String)
    }

    static let flagKey = "bloom.labs.push"

    private(set) var status: Status = .off
    private let defaults: UserDefaults
    /// Set while waiting for APNs; the app delegate hands the token here.
    private var pending: BloomAPI?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// The flag. Also settable at launch: `-bloom.labs.push YES`.
    var isEnabled: Bool { defaults.bool(forKey: Self.flagKey) }

    func setEnabled(_ enabled: Bool, api: BloomAPI?) async {
        defaults.set(enabled, forKey: Self.flagKey)
        if enabled, let api {
            await register(api: api)
        } else {
            status = .off
        }
    }

    /// Re-registers on launch when the flag is on (tokens can change).
    func registerIfEnabled(api: BloomAPI) async {
        guard isEnabled else { return }
        await register(api: api)
    }

    private func register(api: BloomAPI) async {
        status = .requesting
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        guard granted else {
            status = .denied
            return
        }
        pending = api
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// From `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    func didRegister(token: Data) async {
        guard let api = pending else { return }
        pending = nil
        let hex = token.map { String(format: "%02x", $0) }.joined()
        #if DEBUG
        let environment: Components.Schemas.PushEnvironment = .sandbox
        #else
        let environment: Components.Schemas.PushEnvironment = .production
        #endif
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        do {
            let device = try await api.registerDevice(.init(
                platform: .ios,
                pushToken: hex,
                pushEnvironment: environment,
                name: UIDevice.current.name,
                appVersion: "\(version) (\(build))"
            ))
            status = .registered(deviceId: device.id)
        } catch {
            status = .failed(BloomAPIError.from(error).message)
        }
    }

    /// From `application(_:didFailToRegisterForRemoteNotificationsWithError:)`.
    func didFail(_ error: any Error) {
        pending = nil
        status = .failed("APNs registration failed: \((error as NSError).localizedDescription)")
    }
}

/// Receives the APNs callbacks SwiftUI has no modifier for.
final class AppDelegate: NSObject, UIApplicationDelegate {
    var push: PushRegistration?

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await push?.didRegister(token: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        push?.didFail(error)
    }
}
