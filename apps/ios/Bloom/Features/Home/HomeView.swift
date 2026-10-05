import BloomKit
import SwiftUI

/// The signed-in app.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            VStack(spacing: BloomSpacing.s4) {
                Flower(state: .open, size: 72)
                    .accessibilityIdentifier("bloom-flower")
                Text("You're signed in.")
                    .font(.title3)
                    .foregroundStyle(BloomPalette.ink)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(BloomPalette.page.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Settings", systemImage: "gearshape") { showSettings = true }
                        .accessibilityIdentifier("open-settings")
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
        }
    }
}
