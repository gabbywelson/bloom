import BloomKit
import SwiftUI

@main
struct BloomApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(BloomPalette.accent)
        }
    }
}
