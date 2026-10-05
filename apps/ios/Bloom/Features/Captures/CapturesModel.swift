import BloomKit
import Foundation
import Observation

/// New captures (from the share sheet, quick capture, intents), newest first,
/// and filing a quick text capture from inside the app.
@Observable
final class CapturesModel {
    private(set) var captures: [BloomCapture] = []
    private(set) var loading = false
    private(set) var loadedOnce = false
    private(set) var saving = false
    private(set) var error: String?
    /// The capture control asked for the field; the view focuses it and clears this.
    var focusRequested = false

    private let api: BloomAPI
    private let onUnauthorized: () -> Void

    init(api: BloomAPI, onUnauthorized: @escaping () -> Void) {
        self.api = api
        self.onUnauthorized = onUnauthorized
    }

    func refresh() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            captures = try await api.captures(status: [.new]).reversed()
            error = nil
            loadedOnce = true
        } catch .unauthorized {
            onUnauthorized()
        } catch {
            self.error = "Couldn't load captures just now."
        }
    }

    /// Files a text capture; returns `true` when the server has it.
    @discardableResult
    func capture(_ text: String) async -> Bool {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !saving else { return false }
        saving = true
        defer { saving = false }
        do {
            let capture = try await api.createCapture(.text(text))
            captures.insert(capture, at: 0)
            error = nil
            return true
        } catch .unauthorized {
            onUnauthorized()
        } catch {
            self.error = "That didn't save. Give it a moment and try again."
        }
        return false
    }

    /// Takes a capture off the list without filing it anywhere.
    func dismiss(_ id: String) async {
        let before = captures
        captures.removeAll { $0.id == id }
        do {
            _ = try await api.updateCapture(id: id, .init(status: .dismissed))
        } catch .unauthorized {
            onUnauthorized()
        } catch .notFound {
            // Already gone on the server; the list is right.
        } catch {
            captures = before
            self.error = "Couldn't dismiss that just now."
        }
    }
}
