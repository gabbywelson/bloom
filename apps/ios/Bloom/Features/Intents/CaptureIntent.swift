import AppIntents
import BloomKit
import Foundation

/// "Capture to Bloom": files a text capture without opening the app. Works
/// from Siri, Shortcuts, Spotlight and the Action button, using the app's
/// session (ADR 0020). Nothing consequential happens: a capture only waits
/// for triage.
struct CaptureToBloomIntent: AppIntent {
    static let title: LocalizedStringResource = "Capture to Bloom"
    static let description = IntentDescription(
        "Save a thought to Bloom's captures, to sort out later.",
        categoryName: "Capture"
    )
    static let supportedModes: IntentModes = .background

    @Parameter(title: "Text", requestValueDialog: "What should Bloom hold on to?")
    var text: String

    static var parameterSummary: some ParameterSummary {
        Summary("Capture \(\.$text) to Bloom")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw CaptureIntentError.empty }
        let session = SessionStore.shared
        guard let server = session.serverURL, session.token != nil else { throw CaptureIntentError.signedOut }
        do {
            _ = try await BloomAPI(serverURL: server, tokens: session).createCapture(.text(text))
        } catch .unauthorized {
            throw CaptureIntentError.signedOut
        } catch {
            throw CaptureIntentError.unreachable
        }
        return .result(dialog: "Saved to Bloom.")
    }
}

enum CaptureIntentError: Error, CustomLocalizedStringResourceConvertible {
    case empty
    case signedOut
    case unreachable

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .empty: "There was nothing to capture."
        case .signedOut: "Open Bloom and sign in first."
        case .unreachable: "Bloom can't reach the server right now. Nothing was saved."
        }
    }
}

/// Phrases Siri and Spotlight offer without any setup.
struct BloomShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptureToBloomIntent(),
            phrases: [
                "Capture to \(.applicationName)",
                "Save a thought to \(.applicationName)",
                "Tell \(.applicationName) something",
            ],
            shortTitle: "Capture",
            systemImageName: "tray.and.arrow.down"
        )
    }
}
