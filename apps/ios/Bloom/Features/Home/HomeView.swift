import BloomKit
import SwiftUI

/// The signed-in app: the conversation and the task list as tabs.
struct HomeView: View {
    enum Tab: Hashable {
        case chat
        case tasks
    }

    let workspace: Workspace
    @State private var tab: Tab = .chat
    @State private var showSettings = false

    var body: some View {
        TabView(selection: $tab) {
            SwiftUI.Tab("Bloom", systemImage: "bubble.left.and.text.bubble.right", value: Tab.chat) {
                ChatView(showSettings: $showSettings)
            }
            SwiftUI.Tab("Tasks", systemImage: "checklist", value: Tab.tasks) {
                TaskListView(showSettings: $showSettings)
            }
            .badge(workspace.tasks.open.count)
        }
        .tint(BloomPalette.accent)
        // A count, not an alarm: the badge stays quiet.
        .badgeProminence(.decreased)
        .environment(workspace)
        .sheet(isPresented: $showSettings) { SettingsView() }
        // The badge and the first tab switch should not wait for a visit.
        .task { await workspace.tasks.refresh() }
    }
}
