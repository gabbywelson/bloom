import BloomKit
import SwiftUI

@main
struct BloomApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(BloomPalette.accent)
        }
    }
}
