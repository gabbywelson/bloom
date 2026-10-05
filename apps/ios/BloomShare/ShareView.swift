import BloomKit
import SwiftUI

/// "Save to Bloom": a preview of what is being shared, an optional note, Save.
struct ShareView: View {
    @State var model: ShareModel

    private var flower: FlowerState {
        switch model.phase {
        case .saving, .loading: .opening
        case .saved: .open
        default: .closed
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: BloomSpacing.s4) {
                    HStack(spacing: BloomSpacing.s3) {
                        Flower(state: flower, size: 32)
                        Text(model.phase == .saved ? "Saved to Bloom" : "Save to Bloom")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(BloomPalette.ink)
                    }
                    if !model.signedIn {
                        Text("Open Bloom and sign in first; then sharing works from anywhere.")
                            .foregroundStyle(BloomPalette.inkMuted)
                    }
                    preview
                    if case let .failed(message) = model.phase {
                        Text(message)
                            .font(.callout)
                            .foregroundStyle(BloomPalette.danger)
                    }
                }
                .padding(BloomSpacing.s5)
            }
            .background(BloomPalette.page.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.cancel() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.phase == .saving ? "Saving" : "Save") {
                        Task { await model.save() }
                    }
                    .disabled(model.item == nil || !model.signedIn || model.phase == .saving || model.phase == .saved)
                }
            }
        }
        .tint(BloomPalette.accent)
        .task { await model.load() }
    }

    @ViewBuilder private var preview: some View {
        switch model.item {
        case let .link(url, title)?:
            VStack(alignment: .leading, spacing: BloomSpacing.s1) {
                Text(title ?? url.host() ?? url.absoluteString)
                    .font(.body.weight(.medium))
                    .foregroundStyle(BloomPalette.ink)
                Text(url.absoluteString)
                    .font(.footnote)
                    .foregroundStyle(BloomPalette.inkMuted)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .bloomCard()
            noteField("Why save it? (optional)")
        case .text?:
            TextEditor(text: $model.note)
                .frame(minHeight: 140)
                .scrollContentBackground(.hidden)
                .padding(BloomSpacing.s2)
                .background(BloomPalette.surface, in: RoundedRectangle(cornerRadius: BloomSpacing.radius))
                .overlay(RoundedRectangle(cornerRadius: BloomSpacing.radius).strokeBorder(BloomPalette.border))
        case let .image(image)?:
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxHeight: 240)
                .clipShape(RoundedRectangle(cornerRadius: BloomSpacing.radius))
            noteField("Add a caption (optional)")
        case nil:
            if model.phase == .loading {
                Text("Looking at what you shared")
                    .foregroundStyle(BloomPalette.inkMuted)
            }
        }
    }

    private func noteField(_ prompt: String) -> some View {
        TextField(prompt, text: $model.note, axis: .vertical)
            .lineLimit(1...4)
            .padding(BloomSpacing.s3)
            .background(BloomPalette.surface, in: RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall))
            .overlay(RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall).strokeBorder(BloomPalette.border))
    }
}
