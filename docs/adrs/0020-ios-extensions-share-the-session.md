# 0020. iOS extensions share the app's session through a Keychain group and an app group

Date: 2026-10-05

## Context

The share sheet (and next the widget and App Intents) runs as separate
processes. Each needs the server address and the bearer token the app got at
sign-in (ADR 0018), without its own sign-in. There is no paid developer
account yet, so everything must work on the simulator with Xcode's automatic
local signing.

## Decision

- Every target that talks to the server (the app, `BloomShare`, later the
  widget) carries the same entitlements, declared once in `project.yml`:
  `keychain-access-groups: [$(AppIdentifierPrefix)dev.bloom.shared]` and
  `com.apple.security.application-groups: [group.dev.bloom]`.
- The same two names are written into each target's Info.plist
  (`BloomKeychainGroup`, `BloomAppGroup`). `SessionStore.shared` reads them
  from the running bundle, so the code never hard-codes a team prefix: the
  token lives in the shared Keychain group, the server origin and cached user
  in the app group's `UserDefaults`.
- The share extension (`BloomShare`, `com.apple.share-services`) accepts one
  web URL or page, plain text, or one image. A link becomes a `share`
  capture with the page title, text a `text` capture (editable before
  saving), an image an `image` capture downscaled on the device (ADR 0019).
  It files through `BloomAPI.createCapture`, the same generated client as the
  app, and closes itself after a short "Saved to Bloom". Without a session it
  says to open Bloom and sign in.
- Extensions link `BloomKit` from the app's `Frameworks` folder rather than
  embedding their own copy.

## Consequences

- One sign-in serves every surface. Signing out in the app signs out the
  extensions too.
- On this Mac Xcode resolves `$(AppIdentifierPrefix)` to a team prefix it
  already knows; with no team at all it would be empty, and the group names
  would still match because Info.plist and entitlements expand the same
  setting. A real team only needs `DEVELOPMENT_TEAM` and the App Group and
  Keychain Sharing capabilities registered for the bundle ids.
- A session stored before this change (no access group) is not migrated; the
  app shows sign-in once. That only affected tonight's simulator.
- The extension cannot be driven by XCUITest without scripting another app's
  share sheet, so its logic is unit-tested (`CaptureDraft`, `PreparedImage`)
  and the flow was checked by hand in the simulator (Safari → Share → Bloom).
