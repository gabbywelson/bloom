import Foundation
import OpenAPIRuntime

/// Everything a call to the Bloom API can fail with, in terms the app acts on.
public enum BloomAPIError: Error, Equatable, Sendable {
    /// No valid session (401). The app signs out and shows sign-in.
    case unauthorized
    /// The thing asked for does not exist (404).
    case notFound
    /// The server rejected the request as malformed (400).
    case badRequest
    /// Any other status the contract does not describe.
    case unexpectedStatus(Int)
    /// The server could not be reached, or the connection dropped or timed out.
    case unreachable
    /// The response did not match the contract.
    case invalidResponse

    /// Calm, user-facing text. Never includes server detail.
    public var message: String {
        switch self {
        case .unauthorized: "Please sign in again."
        case .notFound: "That isn't there anymore."
        case .badRequest, .unexpectedStatus, .invalidResponse:
            "That didn't go through. Give it a moment and try again."
        case .unreachable: "Bloom can't reach the server right now."
        }
    }

    /// An HTTP status the operation does not document (400 from payload
    /// decoding is one: Effect answers it with an empty body).
    public static func status(_ code: Int) -> BloomAPIError {
        switch code {
        case 400: .badRequest
        case 401: .unauthorized
        case 404: .notFound
        default: .unexpectedStatus(code)
        }
    }

    /// Maps any error thrown by the generated client or the transport.
    public static func from(_ error: any Error) -> BloomAPIError {
        if let error = error as? BloomAPIError { return error }
        if let error = error as? ClientError { return from(error.underlyingError) }
        if error is URLError { return .unreachable }
        if error is DecodingError { return .invalidResponse }
        if error is CancellationError { return .unreachable }
        return .invalidResponse
    }
}
