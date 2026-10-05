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
