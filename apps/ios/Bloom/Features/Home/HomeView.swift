import BloomKit
import SwiftUI

/// The signed-in app.
struct HomeView: View {
    let workspace: Workspace
    @State private var showSettings = false

    var body: some View {
        ChatView(showSettings: $showSettings)
            .environment(workspace)
            .sheet(isPresented: $showSettings) { SettingsView() }
    }
}
