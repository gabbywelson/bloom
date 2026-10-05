import BloomKit
import SwiftUI

/// Top of the view tree: sign-in until there is a session, then the app.
struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            switch model.phase {
            case .signedOut, .signingIn:
                SignInView()
            case .signedIn:
                HomeView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: model.phase)
        .onOpenURL { url in model.handle(url: url) }
        .task { await model.refreshUser() }
    }
}

#Preview {
    RootView().environment(AppModel())
}
