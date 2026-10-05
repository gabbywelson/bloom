import Foundation
import UIKit
import UniformTypeIdentifiers

/// What arrived through the share sheet, reduced to the three things Bloom
/// files: a link (with the page title when the source app provides one),
/// plain text, or a photo.
enum SharedItem {
    case link(URL, title: String?)
    case text(String)
    case image(UIImage)

    /// Reads the first usable attachment. Links win over text (Safari shares
    /// both), text that is just a URL becomes a link.
    static func load(from context: NSExtensionContext?) async -> SharedItem? {
        let items = context?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let title = items.lazy.compactMap { $0.attributedContentText?.string ?? $0.attributedTitle?.string }.first
        let providers = items.flatMap { $0.attachments ?? [] }

        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = await loadURL(provider), url.scheme == "http" || url.scheme == "https" {
                return .link(url, title: title.flatMap { $0.isEmpty || $0 == url.absoluteString ? nil : $0 })
            }
        }
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            if let data = await loadData(provider, type: .image), let image = UIImage(data: data) {
                return .image(image)
            }
        }
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = await loadText(provider)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
                if let url = URL(string: text), url.scheme == "http" || url.scheme == "https", url.host() != nil {
                    return .link(url, title: nil)
                }
                return .text(text)
            }
        }
        return nil
    }

    // Item providers call back on arbitrary queues; only Sendable values cross.

    private static func loadURL(_ provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { url, _ in continuation.resume(returning: url) }
        }
    }

    private static func loadText(_ provider: NSItemProvider) async -> String? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: String.self) { text, _ in continuation.resume(returning: text) }
        }
    }

    private static func loadData(_ provider: NSItemProvider, type: UTType) async -> Data? {
        await withCheckedContinuation { continuation in
            _ = provider.loadDataRepresentation(for: type) { data, _ in continuation.resume(returning: data) }
        }
    }
}
