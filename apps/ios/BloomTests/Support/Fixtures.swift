import Foundation
import Testing

private final class BundleToken {}

/// Test fixtures copied into the test bundle (see project.yml).
enum Fixtures {
    static let bundle = Bundle(for: BundleToken.self)

    /// Bytes of `packages/api/test/fixtures/chat-stream/<name>.sse`.
    static func chatStream(_ name: String) throws -> Data {
        let directory = try #require(bundle.url(forResource: "chat-stream", withExtension: nil))
        return try Data(contentsOf: directory.appending(path: "\(name).sse"))
    }

    /// `data` delivered in chunks of `size` bytes, as a network would.
    static func chunks(_ data: Data, size: Int) -> AsyncStream<ArraySlice<UInt8>> {
        let bytes = [UInt8](data)
        return AsyncStream { continuation in
            var offset = 0
            while offset < bytes.count {
                let end = min(offset + size, bytes.count)
                continuation.yield(bytes[offset..<end])
                offset = end
            }
            continuation.finish()
        }
    }

    static func chunks(_ text: String, size: Int = 1 << 20) -> AsyncStream<ArraySlice<UInt8>> {
        chunks(Data(text.utf8), size: size)
    }
}
