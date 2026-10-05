import Foundation

// Short names for the generated wire types (`Components.Schemas.*`, from
// packages/api/openapi.json). The app talks in these; nothing here is
// hand-written on top of the wire shapes except small conveniences.
public typealias BloomTask = Components.Schemas.Task
public typealias BloomTaskStatus = Components.Schemas.TaskStatus
public typealias BloomTaskCreate = Components.Schemas.TaskCreate
public typealias BloomThread = Components.Schemas.Thread
public typealias BloomMessage = Components.Schemas.Message
public typealias BloomMessageRole = Components.Schemas.MessageRole
public typealias BloomMessagePart = Components.Schemas.MessagePart
public typealias BloomUiComponent = Components.Schemas.UiComponent
public typealias BloomUser = Components.Schemas.AuthUser
public typealias ChatStreamEvent = Components.Schemas.ChatStreamEvent

/// Timestamps travel as ISO-8601 strings with milliseconds (`DateTime.formatIso`).
public enum BloomDate {
    private static let withFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let withoutFraction = Date.ISO8601FormatStyle()

    /// Parses a server timestamp; `nil` when the string is not ISO-8601.
    public static func parse(_ string: String) -> Date? {
        (try? withFraction.parse(string)) ?? (try? withoutFraction.parse(string))
    }

    /// Formats a date the way the server writes them.
    public static func format(_ date: Date) -> String {
        withFraction.format(date)
    }
}

extension BloomTaskStatus {
    /// Statuses the task list shows (the web's `OPEN`): not done, not dropped.
    public static let open: [BloomTaskStatus] = [.inbox, .next, .scheduled, .waiting]

    public var isOpen: Bool { Self.open.contains(self) }

    /// The web's label for each status.
    public var label: String {
        switch self {
        case .inbox: "Inbox"
        case .next: "Next"
        case .scheduled: "Scheduled"
        case .waiting: "Waiting"
        case .done: "Done"
        case .dropped: "Dropped"
        }
    }
}

extension BloomTask {
    public var dueDate: Date? { due.flatMap(BloomDate.parse) }
    public var scheduledDate: Date? { scheduledFor.flatMap(BloomDate.parse) }
    public var createdDate: Date? { BloomDate.parse(createdAt) }
}

extension BloomMessage {
    public var createdDate: Date? { BloomDate.parse(createdAt) }

    /// Text of all `text` parts joined with newlines (the domain's `messageText`).
    public var text: String {
        parts.compactMap { part in
            if case let .text(text) = part { text.text } else { nil }
        }
        .joined(separator: "\n")
    }
}

extension ChatStreamEvent {
    /// `message_end` and `error` end a run; nothing follows them (ADR 0013).
    public var isTerminal: Bool {
        switch self {
        case .messageEnd, .error: true
        default: false
        }
    }
}
