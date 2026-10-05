# Bloom for iOS

SwiftUI app for iPhone, iOS 26 and later. It is a thin client of the Bloom
server: everything it shows comes from `/api`, and it never talks to a model
directly.

## Layout

| Path           | What                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| `project.yml`  | XcodeGen spec; the single source of the Xcode project                    |
| `Bloom/`       | The app target: `App/` (entry, root view), resources                     |
| `BloomKit/`    | Framework shared by the app and its extensions: design system, API, auth |
| `BloomKit/API` | `openapi.json` (symlink), generator config, `BloomAPI` facade, SSE       |
| `BloomShare/`  | Share extension: files links, text and photos as captures (ADR 0020)     |
| `BloomTests/`  | Unit tests (Swift Testing), hosted in the app                            |
| `BloomUITests` | UI tests (XCTest)                                                        |

`Bloom.xcodeproj` is generated and git-ignored. Never edit it by hand; change
`project.yml` and regenerate.

## Commands

Run from the repo root (they wrap `scripts/ios.sh`):

```sh
bun run ios:generate   # project.yml -> Bloom.xcodeproj (needs `brew install xcodegen`)
bun run ios:build      # generate, then build for the iPhone 17 simulator
bun run ios:test       # generate, then run unit + UI tests on the simulator
```

`IOS_DESTINATION` overrides the simulator, for example
`IOS_DESTINATION='platform=iOS Simulator,name=iPhone 16e,OS=26.2' bun run ios:test`.
`VERBOSE=1` streams the full `xcodebuild` output; otherwise only errors, test
verdicts and the result banner are printed, and the full log is written to
`apps/ios/build/<command>.log`. Derived data and SwiftPM checkouts live in
`apps/ios/build/` (git-ignored), so builds do not touch `~/Library`.

To open the project in Xcode: `bun run ios:generate && open apps/ios/Bloom.xcodeproj`.

## Auth: first run

There is no sign-up and no password (ADR 0003). The app signs in with a
one-time link from the server and keeps a bearer token in the Keychain
(ADR 0018).

1. Start the server (`bun run dev:server`, port 3000).
2. On the server machine, ask for a link the phone can reach:

   ```sh
   bun run auth:link --ios --server http://localhost:3000       # simulator
   bun run auth:link --ios --server http://<mac>.<tailnet>.ts.net:3000  # phone
   ```

   It prints `bloom://sign-in?link=…`. Links work once and expire after 15
   minutes.

3. Open it on the phone. In the simulator:

   ```sh
   xcrun simctl openurl booted "$(bun run auth:link --ios --server http://localhost:3000 2>/dev/null | tail -1)"
   ```

   and tap **Open** when iOS asks. On a device, AirDrop or paste it; the
   sign-in screen also accepts the plain magic link (without `--ios`) pasted
   into its field, and has a "Server address" override.

The app opens the link itself (no browser), reads the session token from the
response, confirms it with `GET /api/me`, and from then on sends
`Authorization: Bearer <token>`. Settings shows who is signed in and where,
and **Sign out** revokes the session on the server. Any 401 returns the app to
sign-in. Plain HTTP is allowed only to localhost and `*.ts.net` names.

UI tests launch with `-BloomResetSession`, which clears the stored session.

## API client

The client is generated at build time by swift-openapi-generator from
`packages/api/openapi.json` (ADR 0017). After changing the API, run
`bun run openapi` and build; the generated `Components.Schemas.*` types and
`Client` change with it. `BloomAPI` wraps the generated client in async
methods that throw `BloomAPIError`; `ChatStream.events` turns the chat
endpoint's Server-Sent Events into the generated `ChatStreamEvent` enum.
The unit tests decode the recorded streams in
`packages/api/test/fixtures/chat-stream`, which a bun test keeps
byte-identical to the server's output.

If the generator cannot represent a schema it skips it with a warning, and
the field silently disappears from Swift. `bun run ios:build` prints those
warnings; treat any as a bug in the document.

## What the app does

- **Bloom** tab: the main thread. Replies stream in as they are written;
  the flower opens while Bloom thinks; tool use shows as quiet "used create
  task" lines; task cards, option pickers, confirms and snooze pickers render
  natively (choices go back to Bloom as your reply, like the web).
- **Tasks** tab: open tasks (inbox, next, scheduled, waiting) with "Done"
  (button or swipe). It refreshes when a chat run reports `tasks_changed`,
  on pull-to-refresh and after completing one. The tab badge is the count.
- **Captures** tab: new captures, newest first, with a field to jot one
  down; swipe to dismiss. Links open in the browser; photos show a thumbnail.
- **Share sheet**: "Bloom" in any app's share sheet saves the link (with the
  page title), text or photo as a capture, with an optional note. It uses the
  app's session (shared Keychain group and app group, ADR 0020); sign in to
  the app first.
- **Settings** (gear): who is signed in, the server, sign out, and
  **Apple Health** → "Share daily summaries" (opt-in; ADR 0021): steps, last
  night's sleep and resting heart rate for each completed day, sent as one
  `healthkit` / `daily_summary` event per day. Nothing is sent for days
  without data, which on the simulator is every day.

## Demo mode (UI tests)

Debug builds launched with `-BloomDemo` talk to `DemoServer`, an in-process
`ClientTransport` that answers the generated client with canned data: two
tasks, a greeting, and a reply stream that creates a task when a message
starts with "Add ". The UI tests in `BloomUITests/DemoFlowTests.swift` drive
chat and tasks this way, without a server or a model. It never ships in a
release build (`#if DEBUG`).

## Signing

There is no Apple developer team configured yet. The project builds with
ad-hoc signing (`CODE_SIGN_IDENTITY = -`), which is enough for the simulator.
Before running on a device, set `DEVELOPMENT_TEAM` and replace the
placeholder bundle id prefix (`dev.bloom`) in `project.yml`.

## Look and feel

The palette, spacing scale and flower mark mirror the web app
(`apps/web/src/app.css`, `Flower.svelte`): warm paper background, terracotta
accent, sage center, generous spacing, light and dark variants. The flower has
the same three states: closed (resting), opening (thinking, gently breathing
unless Reduce Motion is on) and open (has something for you).
