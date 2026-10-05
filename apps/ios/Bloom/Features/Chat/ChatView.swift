import BloomKit
import SwiftUI

/// The main thread: the conversation with Bloom.
struct ChatView: View {
    @Environment(Workspace.self) private var workspace
    @Binding var showSettings: Bool

    private var chat: ChatModel { workspace.chat }

    var body: some View {
        NavigationStack {
            content
                .background(BloomPalette.page.ignoresSafeArea())
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        HStack(spacing: BloomSpacing.s2) {
                            Flower(state: chat.streaming ? .opening : .open, size: 22, label: chat.streaming ? "Bloom is thinking" : "Bloom")
                            Text("Bloom").font(.headline).foregroundStyle(BloomPalette.ink)
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Settings", systemImage: "gearshape") { showSettings = true }
                            .accessibilityIdentifier("open-settings")
                    }
                }
        }
        .task { await chat.loadIfNeeded() }
    }

    /// The transcript once there is something to show; until then, a calm
    /// opening state or the failure with a retry.
    @ViewBuilder private var content: some View {
        if !chat.messages.isEmpty || chat.load == .loaded {
            transcript
        } else if case let .failed(message) = chat.load {
            VStack(spacing: BloomSpacing.s3) {
                Flower(state: .closed, size: 48)
                Text(message).foregroundStyle(BloomPalette.danger).multilineTextAlignment(.center)
                Button("Try again") { Task { await chat.reload() } }
                    .buttonStyle(.bloomQuiet)
            }
            .padding(BloomSpacing.s6)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(spacing: BloomSpacing.s3) {
                Flower(state: .opening, size: 48, label: "Bloom is opening")
                Text("Opening").font(.footnote).foregroundStyle(BloomPalette.inkMuted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// An assistant reply with nothing in it yet is shown as the thinking row, not an empty bubble.
    private var visibleMessages: [ChatMessage] {
        chat.messages.filter { !($0.role == .assistant && $0.parts.isEmpty) }
    }

    private var transcript: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: BloomSpacing.s4) {
                if chat.messages.isEmpty && !chat.streaming {
                    VStack(spacing: BloomSpacing.s3) {
                        Flower(state: .closed, size: 40)
                        Text("Nothing here yet. Say hi.").foregroundStyle(BloomPalette.inkMuted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, BloomSpacing.s7)
                }
                ForEach(visibleMessages) { message in
                    MessageRow(message: message, busy: chat.streaming)
                }
                if chat.streaming {
                    HStack(spacing: BloomSpacing.s2) {
                        Flower(state: .opening, size: 22, label: "Bloom is thinking")
                        Text("Bloom is thinking")
                            .font(.footnote)
                            .foregroundStyle(BloomPalette.inkMuted)
                            .accessibilityHidden(true)
                    }
                    .padding(.horizontal, BloomSpacing.s3)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("bloom-thinking")
                    .transition(.opacity)
                }
                if let error = chat.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(BloomPalette.danger)
                        .padding(.horizontal, BloomSpacing.s3)
                        .accessibilityIdentifier("chat-error")
                }
            }
            .padding(.horizontal, BloomSpacing.s4)
            .padding(.vertical, BloomSpacing.s5)
            .animation(.easeOut(duration: 0.2), value: chat.streaming)
        }
        .defaultScrollAnchor(.bottom)
        .defaultScrollAnchor(.bottom, for: .sizeChanges)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await chat.reload() }
        .safeAreaInset(edge: .bottom) {
            Composer(streaming: chat.streaming, enabled: chat.thread != nil) { text in
                await chat.send(text)
            }
        }
    }
}

/// The message field and send button.
struct Composer: View {
    let streaming: Bool
    let enabled: Bool
    let send: (String) async -> Bool

    @State private var draft = ""
    @FocusState private var focused: Bool

    private var canSend: Bool {
        enabled && !streaming && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: BloomSpacing.s2) {
            TextField(streaming ? "Bloom is replying" : "What's on your mind?", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .focused($focused)
                .disabled(streaming)
                .padding(.vertical, BloomSpacing.s2 + 2)
                .padding(.horizontal, BloomSpacing.s3)
                .accessibilityIdentifier("composer-input")
            Button {
                submit()
            } label: {
                Image(systemName: "arrow.up")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BloomPalette.accentInk)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(BloomPalette.accent))
                    .opacity(canSend ? 1 : 0.4)
            }
            .disabled(!canSend)
            .accessibilityLabel("Send")
            .accessibilityIdentifier("composer-send")
            .padding(.bottom, 3)
        }
        .padding(.trailing, BloomSpacing.s1 + 2)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(BloomPalette.surface)
                .shadow(color: .black.opacity(0.06), radius: 12, y: 4)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(focused ? BloomPalette.sage : BloomPalette.border)
        )
        .padding(.horizontal, BloomSpacing.s3)
        .padding(.bottom, BloomSpacing.s2)
    }

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canSend else { return }
        draft = ""
        Task {
            // Give the text back if the send never started (no thread yet, say).
            if !(await send(text)), draft.isEmpty, !streaming { draft = text }
        }
    }
}
