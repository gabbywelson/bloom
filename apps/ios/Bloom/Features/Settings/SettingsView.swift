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
                LabsSection()

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

/// Experimental switches. Push registration stores this phone's token on the
/// server; nothing sends notifications yet (ADR 0023).
private struct LabsSection: View {
    @Environment(AppModel.self) private var model
    @State private var enabled = false

    private var status: String? {
        switch model.push.status {
        case .off: nil
        case .requesting: "Registering"
        case .denied: "Notifications are off for Bloom in iOS Settings."
        case .registered: "Registered with the server."
        case let .failed(message): message
        }
    }

    var body: some View {
        Section {
            Toggle("Register for push", isOn: $enabled)
                .accessibilityIdentifier("push-toggle")
                .onChange(of: enabled) { _, on in
                    Task { await model.push.setEnabled(on, api: model.workspace?.api) }
                }
            if let status {
                Text(status).foregroundStyle(BloomPalette.inkMuted)
            }
        } header: {
            Text("Labs")
        } footer: {
            Text("Groundwork for nudges: stores this phone's notification token on your server. Bloom doesn't send notifications yet.")
        }
        .onAppear { enabled = model.push.isEnabled }
    }
}
