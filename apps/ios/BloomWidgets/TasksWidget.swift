import AppIntents
import BloomKit
import SwiftUI
import WidgetKit

/// The tasks widget has nothing to configure; WidgetKit's async timeline API
/// still wants an intent type.
struct TasksWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Open tasks"
    static let description = IntentDescription("How many tasks are open, and what's due next.")
}

struct TasksEntry: TimelineEntry {
    enum Freshness {
        case live
        /// The server was out of reach; this is the last snapshot the app or widget saw.
        case cached
        case signedOut
    }

    let date: Date
    let snapshot: TaskSnapshot?
    let freshness: Freshness
}

/// Reads open tasks with the app's session (ADR 0020), caches the snapshot in
/// the app group, and falls back to that cache when offline.
struct TasksProvider: AppIntentTimelineProvider {
    static let refreshInterval: TimeInterval = 30 * 60

    func placeholder(in context: Context) -> TasksEntry {
        TasksEntry(date: .now, snapshot: .sample, freshness: .live)
    }

    func snapshot(for configuration: TasksWidgetIntent, in context: Context) async -> TasksEntry {
        if context.isPreview { return placeholder(in: context) }
        return TasksEntry(date: .now, snapshot: TaskSnapshotCache.shared.load() ?? .sample, freshness: .cached)
    }

    func timeline(for configuration: TasksWidgetIntent, in context: Context) async -> Timeline<TasksEntry> {
        let entry = await load()
        return Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(Self.refreshInterval)))
    }

    private func load() async -> TasksEntry {
        let session = SessionStore.shared
        let cache = TaskSnapshotCache.shared
        guard let server = session.serverURL, session.token != nil else {
            return TasksEntry(date: .now, snapshot: nil, freshness: .signedOut)
        }
        do {
            let tasks = try await BloomAPI(serverURL: server, tokens: session).tasks(status: BloomTaskStatus.open)
            let snapshot = TaskSnapshot(tasks: tasks)
            cache.save(snapshot)
            return TasksEntry(date: .now, snapshot: snapshot, freshness: .live)
        } catch .unauthorized {
            return TasksEntry(date: .now, snapshot: nil, freshness: .signedOut)
        } catch {
            return TasksEntry(date: .now, snapshot: cache.load(), freshness: .cached)
        }
    }
}

struct TasksWidgetView: View {
    let entry: TasksEntry
    @Environment(\.widgetFamily) private var family

    private var count: Int { entry.snapshot?.openCount ?? 0 }

    var body: some View {
        content
            .containerBackground(BloomPalette.page, for: .widget)
            .widgetURL(URL(string: "bloom://tasks"))
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryCircular:
            VStack(spacing: 0) {
                Text("\(count)").font(.title2.weight(.semibold))
                Text("open").font(.caption2)
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.freshness == .signedOut ? "Bloom" : "\(count) open")
                    .font(.headline)
                Text(nextLine ?? "Nothing due")
                    .font(.caption)
                    .lineLimit(2)
            }
        default:
            home
        }
    }

    private var nextLine: String? {
        guard let next = entry.snapshot?.next else { return nil }
        return "\(next.title) · \(DateLabels.due(next.due))"
    }

    private var home: some View {
        VStack(alignment: .leading, spacing: BloomSpacing.s2) {
            HStack(alignment: .top) {
                Flower(state: count == 0 ? .closed : .open, size: 26)
                Spacer()
                if entry.freshness != .signedOut {
                    Text("\(count)")
                        .font(.system(size: 34, weight: .semibold, design: .rounded))
                        .foregroundStyle(BloomPalette.ink)
                        .contentTransition(.numericText())
                }
            }
            Spacer(minLength: 0)
            switch entry.freshness {
            case .signedOut:
                Text("Open Bloom to sign in.")
                    .font(.footnote)
                    .foregroundStyle(BloomPalette.inkMuted)
            default:
                Text(count == 1 ? "open task" : "open tasks")
                    .font(.caption)
                    .foregroundStyle(BloomPalette.inkMuted)
                if let next = entry.snapshot?.next {
                    Text(next.title)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(BloomPalette.ink)
                        .lineLimit(2)
                    Text("Due \(DateLabels.due(next.due))")
                        .font(.caption2)
                        .foregroundStyle(BloomPalette.accent)
                } else {
                    Text(count == 0 ? "Nothing waiting on you." : "Nothing due.")
                        .font(.footnote)
                        .foregroundStyle(BloomPalette.ink)
                }
            }
        }
    }
}

struct TasksWidget: Widget {
    static let kind = "dev.bloom.tasks"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: TasksWidgetIntent.self, provider: TasksProvider()) { entry in
            TasksWidgetView(entry: entry)
        }
        .configurationDisplayName("Bloom tasks")
        .description("How many tasks are open, and what's due next.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular])
    }
}

#Preview(as: .systemSmall) {
    TasksWidget()
} timeline: {
    TasksEntry(date: .now, snapshot: .sample, freshness: .live)
    TasksEntry(date: .now, snapshot: TaskSnapshot(openCount: 0, next: nil, updatedAt: .now), freshness: .live)
}
