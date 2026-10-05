import BloomKit
import SwiftUI

/// First-run sign-in (ADR 0018). There is no sign-up: the owner asks the
/// server for a one-time link and opens or pastes it here.
struct SignInView: View {
    @Environment(AppModel.self) private var model
    @State private var link = ""
    @State private var server = ""
    @State private var showServer = false
    @FocusState private var linkFocused: Bool

    private var busy: Bool { model.phase == .signingIn }
    private var canSubmit: Bool { !busy && !link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// Return in either field signs in, so the keyboard never hides the way forward.
    private func submit() {
        guard canSubmit else { return }
        linkFocused = false
        Task { await model.signIn(with: link, serverOverride: server) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BloomSpacing.s5) {
                VStack(alignment: .center, spacing: BloomSpacing.s3) {
                    Flower(state: busy ? .opening : .closed, size: 72, label: busy ? "Bloom is opening" : "Bloom is resting")
                        .accessibilityIdentifier("bloom-flower")
                    Text("Bloom")
                        .font(.largeTitle.weight(.semibold))
                        .foregroundStyle(BloomPalette.ink)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, BloomSpacing.s7)

                VStack(alignment: .leading, spacing: BloomSpacing.s2) {
                    Text("Sign in with a link")
                        .font(.headline)
                        .foregroundStyle(BloomPalette.ink)
                    Text("On the computer running Bloom, run")
                        .foregroundStyle(BloomPalette.inkMuted)
                    Text("bun run auth:link --ios")
                        .font(.callout.monospaced())
                        .foregroundStyle(BloomPalette.ink)
                        .padding(.vertical, BloomSpacing.s1)
                        .padding(.horizontal, BloomSpacing.s2)
                        .background(BloomPalette.surfaceMuted, in: RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall))
                        .textSelection(.enabled)
                    Text("and open the link it prints on this phone, or paste it here. Links work once and expire after 15 minutes.")
                        .foregroundStyle(BloomPalette.inkMuted)
                }
                .font(.callout)

                VStack(alignment: .leading, spacing: BloomSpacing.s3) {
                    TextField("bloom://sign-in?link=…", text: $link)
                        .submitLabel(.go)
                        .onSubmit(submit)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .focused($linkFocused)
                        .accessibilityIdentifier("signin-link")
                        .padding(BloomSpacing.s3)
                        .background(BloomPalette.surface, in: RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall))
                        .overlay(RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall).strokeBorder(BloomPalette.border))

                    DisclosureGroup("Server address", isExpanded: $showServer) {
                        VStack(alignment: .leading, spacing: BloomSpacing.s2) {
                            TextField(model.suggestedServer, text: $server)
                                .submitLabel(.go)
                                .onSubmit(submit)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .keyboardType(.URL)
                                .accessibilityIdentifier("signin-server")
                                .padding(BloomSpacing.s3)
                                .background(BloomPalette.surface, in: RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall))
                                .overlay(RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall).strokeBorder(BloomPalette.border))
                            Text("Leave empty to use the address inside the link.")
                                .font(.footnote)
                                .foregroundStyle(BloomPalette.inkMuted)
                        }
                        .padding(.top, BloomSpacing.s2)
                    }
                    .font(.callout)
                    .tint(BloomPalette.inkMuted)

                    HStack(spacing: BloomSpacing.s3) {
                        Button(action: submit) {
                            Text(busy ? "Signing in" : "Sign in")
                        }
                        .buttonStyle(.bloomPrimary)
                        .disabled(!canSubmit)
                        .accessibilityIdentifier("signin-submit")

                        Button("Paste") {
                            if let text = UIPasteboard.general.string { link = text }
                        }
                        .buttonStyle(.bloomQuiet)
                        .disabled(busy)
                    }
                }

                if let error = model.signInError {
                    Text(error)
                        .font(.callout)
                        .foregroundStyle(BloomPalette.danger)
                        .accessibilityIdentifier("signin-error")
                        .transition(.opacity)
                }
            }
            .padding(BloomSpacing.s5)
            .animation(.easeOut(duration: 0.2), value: model.signInError)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(BloomPalette.page.ignoresSafeArea())
    }
}

#Preview {
    SignInView().environment(AppModel(session: .shared))
}
