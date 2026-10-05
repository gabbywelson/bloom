# 0022. iOS quick capture: an App Intent, a Control, and a tasks widget

Date: 2026-10-05

## Context

Capture has to be faster than opening an app (VISION goal 3). iOS offers
App Intents (Siri, Shortcuts, Spotlight, the Action button), controls for
Control Center and the Lock Screen (iOS 18+), and Home Screen widgets. There
is no paid signing identity tonight; everything has to build and run on the
simulator.

## Decision

- **"Capture to Bloom" App Intent** (`CaptureToBloomIntent`, app target):
  one text parameter, `supportedModes = .background`, files a `text`
  capture with the shared session (ADR 0020) and answers "Saved to Bloom."
  `BloomShortcuts` publishes it as an App Shortcut ("Capture to Bloom", "Save
  a thought to Bloom", "Tell Bloom something"), so Siri and Spotlight offer
  it with no setup. Errors are calm sentences (signed out, unreachable).
- **Control** (`CaptureControl`, widget extension): a Control Center / Lock
  Screen button whose action is `OpenURLIntent(bloom://capture)`. The app
  routes that URL to the Captures tab with the field focused. A URL keeps the
  control free of intent types shared between targets; typing needs the app
  anyway.
- **Tasks widget** (`TasksWidget`, small/medium/Lock Screen rectangular and
  circular): open task count and the earliest due task. Its timeline provider
  reads `GET /api/tasks` with the shared session every 30 minutes and caches
  the snapshot in the app group; offline it shows the cache, signed out it
  says so. The app writes the same cache whenever its task list changes and
  asks WidgetKit to reload, so the widget follows the app without polling
  faster. Tapping it opens `bloom://tasks`. Demo mode never writes the cache.
- **URL routes.** `bloom://tasks` and `bloom://capture` join
  `bloom://sign-in`; `AppModel.route` carries them to the tab view.

## Consequences

- The intent and widget run outside the app's process and only need the
  shared Keychain group and app group, which a real team must register.
- Not verified by hand tonight: running the intent from Siri/Shortcuts and
  placing the widget and control (the simulator tooling available drives
  one app at a time). Verified: everything builds and is embedded, App
  Intents metadata lists the intent, its phrases and the widget intent,
  `bloom://capture` opens the focused Captures field, and the snapshot logic
  has unit tests.
- A voice-first capture (dictation straight into the intent) is a later
  step; the text parameter already accepts dictation when Siri asks.
