import BloomKit
import Foundation
import OpenAPIRuntime
import Testing
import UIKit

@Suite("Capture drafts and summaries (ADR 0019)")
struct CaptureTests {
    /// The payload as plain JSON, the way the server receives it.
    private func json(_ draft: CaptureDraft) throws -> [String: Any] {
        let data = try JSONEncoder().encode(draft.payload)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func capture(kind: BloomCaptureKind, payload: [String: (any Sendable)?], transcript: String? = nil) throws -> BloomCapture {
        BloomCapture(
            id: "c1", kind: kind, payload: try OpenAPIValueContainer(unvalidatedValue: payload), transcript: transcript,
            status: .new, routedTo: nil, createdAt: "2026-10-05T07:30:00.000Z", updatedAt: "2026-10-05T07:30:00.000Z"
        )
    }

    @Test("text captures are { text }")
    func text() throws {
        let draft = CaptureDraft.text("Buy stamps")
        #expect(draft.kind == .text)
        #expect(try json(draft) as NSDictionary == ["text": "Buy stamps"] as NSDictionary)
    }

    @Test("shared links keep only the fields that have values")
    func share() throws {
        let full = CaptureDraft.share(url: URL(string: "https://example.com/a")!, title: " An article ", note: "for the weekend")
        #expect(full.kind == .share)
        #expect(try json(full) as NSDictionary == [
            "url": "https://example.com/a", "title": "An article", "text": "for the weekend",
        ] as NSDictionary)
        let bare = CaptureDraft.share(url: URL(string: "https://example.com/b")!, title: nil, note: "  ")
        #expect(try json(bare) as NSDictionary == ["url": "https://example.com/b"] as NSDictionary)
    }

    @Test("photos are downscaled JPEG data URLs with their size")
    func image() throws {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 4000, height: 2000), format: {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            return format
        }())
        let big = renderer.image { context in
            UIColor.systemOrange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 4000, height: 2000))
        }
        let prepared = try #require(PreparedImage(big))
        #expect(prepared.width == 1600)
        #expect(prepared.height == 800)
        #expect(prepared.jpeg.starts(with: [0xFF, 0xD8]))

        let small = try #require(PreparedImage(renderer.image { _ in }, maxSide: 8000))
        #expect(small.width == 4000)

        let payload = try json(.image(prepared, caption: "Fern progress"))
        #expect((payload["dataUrl"] as? String)?.hasPrefix("data:image/jpeg;base64,") == true)
        #expect(payload["width"] as? Int == 1600)
        #expect(payload["height"] as? Int == 800)
        #expect(payload["caption"] as? String == "Fern progress")
    }

    @Test("summaries show what a capture is")
    func summaries() throws {
        let link = CaptureSummary(try capture(kind: .share, payload: ["url": "https://example.com/a", "title": "An article"]))
        #expect(link.title == "An article")
        #expect(link.detail == "example.com")
        #expect(link.url?.absoluteString == "https://example.com/a")

        let bareLink = CaptureSummary(try capture(kind: .share, payload: ["url": "https://example.com/a"]))
        #expect(bareLink.title == "example.com")

        #expect(CaptureSummary(try capture(kind: .text, payload: ["text": "Buy stamps"])).title == "Buy stamps")
        #expect(CaptureSummary(try capture(kind: .voice, payload: [:], transcript: "Call mum")).title == "Call mum")

        let photo = CaptureSummary(try capture(kind: .image, payload: ["dataUrl": "data:image/jpeg;base64,/9j/", "width": 1, "height": 1]))
        #expect(photo.title == "Photo")
        #expect(photo.imageData == Data([0xFF, 0xD8, 0xFF]))
    }
}
