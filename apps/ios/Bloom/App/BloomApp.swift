import BloomKit
import SwiftUI

@main
struct BloomApp: App {
    @UIApplicationDelegateAdaptor private var delegate: AppDelegate
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(BloomPalette.accent)
                .onAppear { delegate.push = model.push }
        }
    }
}
