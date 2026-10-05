import BloomKit
import SwiftUI

/// Who is signed in, to which server, and the way out.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var signingOut = false

    private var user: BloomUser? {
        if case let .signedIn(user) = model.phase { user } else { nil }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Signed in") {
                    if let user, !user.email.isEmpty {
                        LabeledContent("Name", value: user.name)
                        LabeledContent("Email", value: user.email)
                    }
                    if let server = model.session.serverURL {
                        LabeledContent("Server", value: server.absoluteString)
                    }
                }
                HealthSection()

                Section {
                    Button(role: .destructive) {
                        signingOut = true
                        Task {
                            await model.signOut()
                            dismiss()
                        }
                    } label: {
                        Text(signingOut ? "Signing out" : "Sign out")
                    }
                    .disabled(signingOut)
                    .accessibilityIdentifier("sign-out")
                } footer: {
                    Text("Signing in again needs a fresh link from bun run auth:link --ios.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(BloomPalette.page)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

/// Opt-in for daily Apple Health summaries (ADR 0021).
private struct HealthSection: View {
    @Environment(AppModel.self) private var model

    private var health: HealthSync { model.health }

    var body: some View {
        Section {
            if health.status == .unavailable {
                Text("Apple Health isn't available on this device.")
                    .foregroundStyle(BloomPalette.inkMuted)
            } else {
                Toggle("Share daily summaries", isOn: Binding(
                    get: { health.isEnabled },
                    set: { on in
                        if on {
                            guard let api = model.workspace?.api else { return }
                            Task { await health.enable(api: api) }
                        } else {
                            health.disable()
                        }
                    }
                ))
                .accessibilityIdentifier("health-toggle")
                if health.status == .syncing {
                    Text("Sending").foregroundStyle(BloomPalette.inkMuted)
                } else if let result = health.lastResult {
                    Text(result).foregroundStyle(BloomPalette.inkMuted)
                }
            }
        } header: {
            Text("Apple Health")
        } footer: {
            Text("Once a day: steps, last night's sleep and resting heart rate, as one private summary on your server. Bloom doesn't bring it up unless you do.")
        }
    }
}
