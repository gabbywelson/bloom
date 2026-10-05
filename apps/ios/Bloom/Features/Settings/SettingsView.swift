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
