import BloomKit
import SwiftUI

/// Raw captures waiting for triage, and a field to jot one down.
struct CapturesView: View {
    @Environment(Workspace.self) private var workspace
    @Binding var showSettings: Bool
    @State private var draft = ""
    @FocusState private var focused: Bool

    private var model: CapturesModel { workspace.captures }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: BloomSpacing.s2) {
                        TextField("Jot something down", text: $draft, axis: .vertical)
                            .lineLimit(1...4)
                            .focused($focused)
                            .submitLabel(.done)
                            .accessibilityIdentifier("capture-input")
                        Button {
                            Task {
                                if await model.capture(draft) {
                                    draft = ""
                                    focused = false
                                }
                            }
                        } label: {
                            Image(systemName: "arrow.down.to.line")
                                .font(.body.weight(.semibold))
                        }
                        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.saving)
                        .accessibilityLabel("Capture")
                        .accessibilityIdentifier("capture-save")
                    }
                    .listRowBackground(BloomPalette.surface)
                } footer: {
                    Text("Captures wait here until Bloom sorts them. Share links and photos from any app with the share sheet.")
                }

                Section {
                    if model.captures.isEmpty {
                        Text(model.loading && !model.loadedOnce ? "Looking" : "Nothing captured yet.")
                            .foregroundStyle(BloomPalette.inkMuted)
                            .listRowBackground(Color.clear)
                            .accessibilityIdentifier("captures-empty")
                    }
                    ForEach(model.captures, id: \.id) { capture in
                        CaptureRow(capture: capture)
                            .listRowBackground(BloomPalette.surface)
                            .swipeActions(edge: .trailing) {
                                Button("Dismiss", systemImage: "xmark") {
                                    Task { await model.dismiss(capture.id) }
                                }
                                .tint(BloomPalette.inkMuted)
                            }
                    }
                }

                if let error = model.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(BloomPalette.danger)
                        .listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .background(BloomPalette.page.ignoresSafeArea())
            .navigationTitle("Captures")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Settings", systemImage: "gearshape") { showSettings = true }
                }
            }
            .refreshable { await model.refresh() }
        }
        .task { await model.refresh() }
        .onChange(of: model.focusRequested, initial: true) { _, requested in
            guard requested else { return }
            focused = true
            model.focusRequested = false
        }
    }
}

/// One capture: a kind icon, what it is, and when.
struct CaptureRow: View {
    let capture: BloomCapture

    private var summary: CaptureSummary { CaptureSummary(capture) }

    private var icon: String {
        switch capture.kind {
        case .text: "text.alignleft"
        case .share: "link"
        case .image: "photo"
        case .voice: "waveform"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: BloomSpacing.s3) {
            if let data = summary.imageData, let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall))
            } else {
                Image(systemName: icon)
                    .foregroundStyle(BloomPalette.sage)
                    .frame(width: 24)
                    .padding(.top, 2)
            }
            VStack(alignment: .leading, spacing: BloomSpacing.s1) {
                Text(summary.title)
                    .foregroundStyle(BloomPalette.ink)
                    .lineLimit(3)
                if let detail = summary.detail {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(BloomPalette.inkMuted)
                        .lineLimit(1)
                }
                if let created = BloomDate.parse(capture.createdAt) {
                    Text("\(DateLabels.due(created)), \(DateLabels.time(created))")
                        .font(.caption)
                        .foregroundStyle(BloomPalette.inkFaint)
                }
            }
            Spacer(minLength: 0)
            if let url = summary.url {
                Link(destination: url) {
                    Image(systemName: "arrow.up.right.square")
                        .foregroundStyle(BloomPalette.inkMuted)
                }
                .accessibilityLabel("Open link")
            }
        }
        .padding(.vertical, BloomSpacing.s1)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("capture-item")
    }
}
