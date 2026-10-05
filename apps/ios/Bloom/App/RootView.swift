import BloomKit
import SwiftUI

/// Top of the view tree. For now a calm welcome; sign-in, chat and tasks
/// hang off this once the API client exists.
struct RootView: View {
    @State private var flower: FlowerState = .closed

    var body: some View {
        ZStack {
            BloomPalette.page.ignoresSafeArea()
            VStack(spacing: BloomSpacing.s4) {
                Flower(state: flower, size: 96)
                    .accessibilityIdentifier("bloom-flower")
                Text("Bloom")
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(BloomPalette.ink)
                Text("A calm place for the things on your mind.")
                    .font(.callout)
                    .foregroundStyle(BloomPalette.inkMuted)
                    .multilineTextAlignment(.center)
            }
            .padding(BloomSpacing.s6)
        }
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            flower = .opening
            try? await Task.sleep(for: .seconds(1.2))
            flower = .open
        }
    }
}

#Preview {
    RootView()
}
