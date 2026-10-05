import BloomKit
import SwiftUI

/// The signed-in app: the conversation and the task list as tabs.
struct HomeView: View {
    enum Tab: Hashable {
        case chat
        case tasks
        case captures
    }

    let workspace: Workspace
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
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
            SwiftUI.Tab("Captures", systemImage: "tray", value: Tab.captures) {
                CapturesView(showSettings: $showSettings)
            }
        }
        .tint(BloomPalette.accent)
        .environment(workspace)
        .sheet(isPresented: $showSettings) { SettingsView() }
        // The badge and the first tab switch should not wait for a visit.
        .task { await workspace.tasks.refresh() }
        .onChange(of: model.route, initial: true) { _, route in
            switch route {
            case .tasks?: tab = .tasks
            case .capture?:
                tab = .captures
                workspace.captures.focusRequested = true
            case nil: return
            }
            model.route = nil
        }
        // Health summaries go out when the app comes forward (a no-op unless enabled).
        .task(id: scenePhase) {
            if scenePhase == .active { await model.health.sync(api: workspace.api) }
        }
    }
}
