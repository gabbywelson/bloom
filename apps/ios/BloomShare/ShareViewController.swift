import BloomKit
import SwiftUI
import UIKit

/// The share extension's entry point (NSExtensionPrincipalClass): hosts the
/// SwiftUI sheet and hands it the extension context.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareModel(context: extensionContext)
        let host = UIHostingController(rootView: ShareView(model: model))
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
    }
}

/// Loads the shared item, files it as a Capture, and closes the sheet.
@Observable
final class ShareModel {
    enum Phase: Equatable {
        case loading
        case ready
        case saving
        case saved
        case failed(String)
    }

    private(set) var phase: Phase = .loading
    private(set) var item: SharedItem?
    /// Optional note for links and photos; the editable text for text shares.
    var note = ""

    private let context: NSExtensionContext?
    private let session = SessionStore.shared

    init(context: NSExtensionContext?) {
        self.context = context
    }

    var signedIn: Bool { session.isSignedIn }

    func load() async {
        item = await SharedItem.load(from: context)
        if case let .text(text)? = item { note = text }
        phase = item == nil ? .failed("Bloom can't save this kind of item yet.") : .ready
    }

    func save() async {
        guard let item, let server = session.serverURL, session.token != nil else {
            phase = .failed("Open Bloom and sign in first.")
            return
        }
        phase = .saving
        let draft: CaptureDraft
        switch item {
        case let .link(url, title):
            draft = .share(url: url, title: title, note: note)
        case .text:
            draft = .text(note)
        case let .image(image):
            guard let prepared = PreparedImage(image) else {
                phase = .failed("That image couldn't be read.")
                return
            }
            draft = .image(prepared, caption: note)
        }
        do {
            _ = try await BloomAPI(serverURL: server, tokens: session).createCapture(draft)
            phase = .saved
            try? await Task.sleep(for: .milliseconds(900))
            context?.completeRequest(returningItems: [])
        } catch .unauthorized {
            phase = .failed("Open Bloom and sign in again.")
        } catch {
            phase = .failed(error.message)
        }
    }

    func cancel() {
        context?.cancelRequest(withError: CocoaError(.userCancelled))
    }
}
