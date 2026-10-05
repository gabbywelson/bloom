import Foundation
import OpenAPIRuntime
import UIKit

/// A capture about to be filed: its kind and the conventional payload
/// shape for that kind (ADR 0019). The only place payloads are built, so
/// every client surface (share sheet, quick capture, App Intents) agrees.
public struct CaptureDraft: Sendable {
    public let kind: BloomCaptureKind
    public let payload: OpenAPIValueContainer

    /// Quick text: `{ text }`.
    public static func text(_ text: String) -> CaptureDraft {
        make(.text, ["text": text])
    }

    /// A shared link or page: `{ url?, title?, text? }` (only the keys that have values).
    public static func share(url: URL?, title: String?, note: String?) -> CaptureDraft {
        make(.share, [
            "url": url?.absoluteString,
            "title": title.nonEmpty,
            "text": note.nonEmpty,
        ])
    }

    /// A photo: `{ dataUrl, width, height, caption? }` from an already prepared JPEG.
    public static func image(_ image: PreparedImage, caption: String?) -> CaptureDraft {
        make(.image, [
            "dataUrl": "data:image/jpeg;base64,\(image.jpeg.base64EncodedString())",
            "width": image.width,
            "height": image.height,
            "caption": caption.nonEmpty,
        ])
    }

    private static func make(_ kind: BloomCaptureKind, _ fields: [String: (any Sendable)?]) -> CaptureDraft {
        let present = fields.compactMapValues { $0 }
        // Strings and integers are always valid JSON values.
        let payload = (try? OpenAPIValueContainer(unvalidatedValue: present)) ?? nil
        return CaptureDraft(kind: kind, payload: payload)
    }
}

/// A photo downscaled for upload: longest side at most `maxSide` pixels,
/// JPEG at `quality` (ADR 0019: images travel inline until blob storage).
public struct PreparedImage: Sendable {
    public let jpeg: Data
    public let width: Int
    public let height: Int

    public static let maxSide: CGFloat = 1600
    public static let quality: CGFloat = 0.7

    public init?(_ image: UIImage, maxSide: CGFloat = PreparedImage.maxSide, quality: CGFloat = PreparedImage.quality) {
        let size = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        guard size.width > 0, size.height > 0 else { return nil }
        let factor = min(1, maxSide / max(size.width, size.height))
        let target = CGSize(width: (size.width * factor).rounded(), height: (size.height * factor).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        guard let jpeg = resized.jpegData(compressionQuality: quality) else { return nil }
        self.jpeg = jpeg
        width = Int(target.width)
        height = Int(target.height)
    }
}

extension Optional where Wrapped == String {
    /// `nil` for nil, empty or whitespace-only strings; otherwise the trimmed text.
    var nonEmpty: String? {
        guard let trimmed = self?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }
}

/// What the app shows for a capture in a list.
public struct CaptureSummary: Equatable, Sendable {
    public let title: String
    public let detail: String?
    public let url: URL?
    /// The inline JPEG of an image capture, decoded.
    public let imageData: Data?

    public init(_ capture: BloomCapture) {
        let fields = capture.payload.value as? [String: (any Sendable)?] ?? [:]
        func string(_ key: String) -> String? {
            ((fields[key] ?? nil) as? String).nonEmpty
        }
        let url = string("url").flatMap(URL.init(string:))
        switch capture.kind {
        case .text:
            title = string("text") ?? capture.transcript ?? "Note"
            detail = nil
        case .share:
            let pageTitle = string("title")
            title = pageTitle ?? string("text") ?? url?.host() ?? "Shared item"
            detail = pageTitle == nil ? url?.host() : (string("text") ?? url?.host())
        case .image:
            title = string("caption") ?? "Photo"
            detail = nil
        case .voice:
            title = capture.transcript ?? "Voice memo"
            detail = nil
        }
        self.url = url
        imageData = capture.kind == .image ? string("dataUrl").flatMap(Self.decodeDataURL) : nil
    }

    /// The bytes of a `data:<type>;base64,<data>` URL.
    static func decodeDataURL(_ dataURL: String) -> Data? {
        guard dataURL.hasPrefix("data:"), let comma = dataURL.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...]))
    }
}
