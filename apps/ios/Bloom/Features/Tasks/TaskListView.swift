import BloomKit
import SwiftUI

/// Open tasks (inbox, next, scheduled, waiting), like the web's task pane.
struct TaskListView: View {
    @Environment(Workspace.self) private var workspace
    @Binding var showSettings: Bool

    private var tasks: TasksModel { workspace.tasks }

    var body: some View {
        NavigationStack {
            Group {
                if tasks.open.isEmpty {
                    empty
                } else {
                    list
                }
            }
            .background(BloomPalette.page.ignoresSafeArea())
            .navigationTitle("Tasks")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Settings", systemImage: "gearshape") { showSettings = true }
                }
            }
            .refreshable { await tasks.refresh() }
            .safeAreaInset(edge: .bottom) {
                if let error = tasks.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(BloomPalette.danger)
                        .padding(BloomSpacing.s3)
                        .accessibilityIdentifier("tasks-error")
                }
            }
        }
        .task { await tasks.refresh() }
    }

    private var empty: some View {
        ScrollView {
            VStack(spacing: BloomSpacing.s3) {
                Flower(state: tasks.loading && !tasks.loadedOnce ? .opening : .closed, size: 48)
                Text(tasks.loading && !tasks.loadedOnce ? "Looking" : "Nothing waiting on you.")
                    .foregroundStyle(BloomPalette.inkMuted)
                    .accessibilityIdentifier("tasks-empty")
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 160)
        }
    }

    private var list: some View {
        List {
            ForEach(tasks.open, id: \.id) { task in
                TaskRow(task: task, completing: tasks.completing) {
                    Task { await tasks.complete(task.id) }
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: BloomSpacing.s1, leading: BloomSpacing.s4, bottom: BloomSpacing.s1, trailing: BloomSpacing.s4))
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    Button("Done", systemImage: "checkmark") {
                        Task { await tasks.complete(task.id) }
                    }
                    .tint(BloomPalette.sage)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .animation(.easeOut(duration: 0.25), value: tasks.open.map(\.id))
    }
}

/// One task card: title, status, the web's meta line, and "Done".
struct TaskRow: View {
    let task: BloomTask
    let completing: String?
    let complete: () -> Void

    private var when: String? {
        if let due = task.dueDate { return "Due \(DateLabels.due(due))" }
        if let scheduled = task.scheduledDate { return DateLabels.due(scheduled) }
        return nil
    }

    private var meta: [String] {
        var parts: [String] = []
        if let area = task.area, !area.isEmpty { parts.append(area) }
        if let when { parts.append(when) }
        if let effort = task.effort { parts.append(effort == 1 ? "1 spoon" : "\(effort) spoons") }
        return parts
    }

    var body: some View {
        VStack(alignment: .leading, spacing: BloomSpacing.s2) {
            HStack(alignment: .firstTextBaseline, spacing: BloomSpacing.s2) {
                Text(task.title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(BloomPalette.ink)
                Spacer(minLength: BloomSpacing.s2)
                StatusChip(status: task.status)
            }
            if !meta.isEmpty {
                Text(meta.joined(separator: " · "))
                    .font(.footnote)
                    .foregroundStyle(BloomPalette.inkMuted)
            }
            HStack {
                Spacer()
                Button(completing == task.id ? "Saving" : "Done", action: complete)
                    .buttonStyle(.bloomQuiet)
                    .disabled(completing != nil)
                    .accessibilityIdentifier("task-done")
            }
        }
        .bloomCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("task-item")
    }
}
