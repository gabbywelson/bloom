# Overnight report: iOS client, 2026-10-04 → 2026-10-05

Read this first. The table is the summary; the log has the evidence; the
"Morning checklist" at the end is what needs a human.

## Status at a glance

| #   | Backlog item                   | State       | Commits                      |
| --- | ------------------------------ | ----------- | ---------------------------- |
| 1   | iOS app skeleton               | done        | d325f6f15                    |
| 2   | Typed Swift client + SSE       | done        | 9fc8c8dad, bc5e37908         |
| 3   | Auth for iOS (bearer)          | done        | 6fafd5e6c                    |
| 4   | Chat on iOS                    | in progress |                              |
| 5   | Tasks on iOS                   | not started |                              |
| 6   | Capture API + share sheet      | not started |                              |
| 7   | HealthKit summaries → Events   | not started |                              |
| 8   | Quick capture surfaces         | not started |                              |
| 9   | Device registration groundwork | not started |                              |
| 10  | Web parity items               | not started |                              |
| –   | Infra fix found on the way     | done        | 9ba57885d (compose name pin) |

## Log

### Entry 1 (21:38, start of session)

- Read CLAUDE.md, VISION, ARCHITECTURE, ADRs 0001–0016, SOUL, the brief.
- The worktree had no `node_modules` and no `.env`: ran `bun install` and
  symlinked `.env` from the main checkout (git-ignored, not committed).
- Baseline `bun run check`: green, 206 tests.

### Entry 2 (22:42)

**Landed**

- `d325f6f15` iOS skeleton. `apps/ios/project.yml` (XcodeGen, already
  installed via Homebrew), targets Bloom / BloomKit / BloomTests /
  BloomUITests, iOS 26.0 deployment target, Swift 6. `Bloom.xcodeproj` is
  generated and git-ignored. Root scripts `ios:generate`, `ios:build`,
  `ios:test` wrap `scripts/ios.sh` (derived data under `apps/ios/build`,
  summary output, full log on disk). Palette, spacing and the flower
  (closed/opening/open, breathing unless Reduce Motion) mirror the web.
- `9fc8c8dad` + `bc5e37908` Swift client (ADR 0017). swift-openapi-generator
  runs as a build plugin over a symlink to `packages/api/openapi.json`. To
  make that usable the OpenAPI document changed (same JSON Schema meaning):
  named components (`Task`, `MessagePart`, ...), `ChatStreamEvent` added as
  components, tagged unions as `oneOf` + `discriminator`, and nullable
  `anyOf [X, null]` rewritten as `type: [X, "null"]`. The last one matters:
  the generator silently dropped every nullable field before it. The SSE
  call is a generated call too; only the event framing is hand-written
  (`ChatStream.events`). Recorded streams live in
  `packages/api/test/fixtures/chat-stream`; a bun test proves they are
  byte-identical to the server's encoder, and the Swift tests decode them.
- `6fafd5e6c` iOS auth (ADR 0018). Better Auth `bearer` plugin
  (`requireSignature: true`); middleware forwards `Authorization: Bearer`
  besides the cookie; `bun run auth:link --ios [--server <origin>]` prints
  `bloom://sign-in?link=…`; the app opens the magic link itself, keeps the
  `set-auth-token` value in the Keychain, signs out via
  `/api/auth/sign-out`.
- `9ba57885d` `name: bloom` in `docker-compose.yml` (see "Incident").

**Verified, and how**

- `bun run check` green at every commit; now 247 tests (api 34, server 34).
- `bun run ios:test`: `✔ Test run with 31 tests in 6 suites passed`,
  `Executed 2 tests, with 0 failures` (UI), `** TEST SUCCEEDED **`.
- `apps/server/test/bearer.integration.test.ts` against `bloom_test`:
  magic link → `set-auth-token` → session resolves; link replay, tampered
  and unsigned tokens rejected; bearer sign-out revokes.
- Live: server on :3101, a link from
  `bun run auth:link --ios --server http://localhost:3101`, opened in the
  iPhone 17 (iOS 27.0) simulator →
  server log `GET /api/auth/magic-link/verify` 302, `GET /api/me` 200 →
  "You're signed in", Settings shows the owner and server. `grep -c token=`
  on the server log: 0.

**Incident: OrbStack stall, and a stray compose project (cleaned up)**

- At 22:20 Postgres stopped answering (even `pg_isready` hung): the ADR 0010
  stall. Ran `orb stop && orb start`, then
  `docker compose up -d postgres otel-collector jaeger` as instructed. From a
  git worktree that command
  used the directory name as the project name and created a second project
  `t3code-5a275e74` (3 containers in "Created", a network, an empty volume)
  that failed on :5432. Removed exactly that project
  (`docker compose -p t3code-5a275e74 down -v`); the `bloom` volumes were
  never touched. Fixed for good in `9ba57885d`.
- The OrbStack restart also brought back the Langfuse containers (they have
  `restart: unless-stopped` and were running when I started). Since tonight's
  instructions say not to run the Langfuse profile, I stopped them
  (`docker compose --profile langfuse stop …`; not removed). Bring them back
  with `bun run infra:up:langfuse`.

**Notes**

- The generated Swift client is not committed; it is regenerated on every
  build from the committed `openapi.json`.
- Swift 6.4 crashed in SILGen on an `async` URLSession delegate method with
  approachable concurrency on; the completion-handler form is used instead
  (comment in `AuthClient.swift`).

### Entry 3 (23:25)

**Landed**

- `669f805dc` Chat. `ChatTranscript` (BloomKit) is the Swift twin of the
  web's `chat.ts` reducer, with tests mirroring `chat.test.ts`. The main
  thread streams: the flower opens in the toolbar plus a "Bloom is thinking"
  row; tool parts read "used create task"; task cards, option pickers,
  confirms and snooze pickers render natively with the web's rules; `error`
  shows calmly; `tasks_changed` refreshes the task list.
- `ec4f49964` Tasks tab (open statuses, Done by button or swipe, pull to
  refresh, count badge) and a debug-only demo mode (`-BloomDemo`): an
  in-process `ClientTransport` that speaks the same generated client, so UI
  tests drive chat, tasks and captures without a server or a model.
- `51981cfc0` Captures API: `CaptureService` (domain, memory layer, Postgres
  layer with `capture.*` audit events that never include the payload), the
  `captures` HttpApi group, handlers, openapi.json. Plus migration
  `0003_ordering_repair`: `bloom_test` lacked `seq` on `captures`/`nudges`
  because 0002 had been edited after it ran there. Idempotent; a no-op on the
  dev DB. ADR 0019.
- `aab4ac818` Share extension (links with page title, text, photos
  downscaled to a 1600 px JPEG data URL) and a Captures tab (quick text
  capture, swipe to dismiss). The app and extension share the session through
  a Keychain access group plus an app group. ADR 0020.
- `05e3ec718` `POST /api/events` (tagged Inserted/Duplicate result; the
  `domain`/`system` sources are refused) and the iOS HealthKit sync: opt-in
  in Settings, one `healthkit/daily_summary` event per completed day keyed
  `healthkit:<day>`. ADR 0021.

**Verified, and how**

- `bun run check` green at each commit (latest: agent 40, api 40, db 17,
  domain 40, integrations 4, pipeline 57, server 39, web 7).
- `bun run ios:test`: `✔ Test run with 51 tests in 10 suites passed`;
  UI `Executed 5 tests, with 0 failures`; `** TEST SUCCEEDED **`.
- Real model, from the simulator, server on :3101 against the dev DB: two
  turns ("Please add a task: look over the Bloom iPhone app in the
  morning." → Bloom asked which morning → "Tomorrow morning." → "used
  create task"). Jaeger traces **`6a53516dfe2dbe59dd4376e432a4b161`** (26
  spans) and **`0476642571a364087b11f4ff14ee904c`** (37 spans:
  `http.server POST` → `auth.session` → `agent.run` → `ModelProvider.stream` →
  `TaskService.create`). The `authorization` header shows as `<redacted>` in
  the span.
- Tasks live: Done on an e2e leftover ("Water the ferns-muuqiylg") →
  `POST /api/tasks/:id/complete` 200, list refetched, badge 4 → 3.
- Captures live: curl with a bearer token (POST 200, `?status=new`, PATCH
  dismissed, 404, 400, 401); Safari → Share → Bloom → Save filed a share
  capture with the URL and title "Example Domain", and the Captures tab
  listed it.
- Events live: curl Inserted → Duplicate → 400 for `source: domain` → 401.
  HealthKit: the real permission sheet (three types plus iOS 27's history
  step), then "Up to date." and no request, as the simulator has no data.

**Things I created in the dev database** (all harmless, listed so nothing
is a surprise): the task "Look over the Bloom iPhone app" (due tomorrow,
from the real chat check), a completed e2e task, one dismissed share
capture (`https://example.com/curl-check`), one open share capture
(`https://example.com/`), and one `healthkit-curl-check` event. Several
Better Auth sessions for the owner from sign-in tests.

**Noticed, not changed**

- Bloom said "Once I've added a task I can't change it": the agent toolkit
  has `create_task` and `list_tasks` but no update/complete tool, so it asks
  up front. A good next server item, outside tonight's backlog.
- UI tests run on the same "iPhone 17" simulator I use by hand and launch
  with `-BloomResetSession`, so after `bun run ios:test` the app on that
  simulator is signed out. Expected.

## Morning checklist

- Langfuse is stopped (see incident); `bun run infra:up:langfuse` restores it.
- Bundle id prefix is a placeholder (`dev.bloom` in `apps/ios/project.yml`);
  set it and `DEVELOPMENT_TEAM` before running on a phone. Register the App
  Group `group.dev.bloom` and Keychain Sharing for the app and the share
  extension, and the HealthKit capability for the app.
- Try it: `bun run dev:server`, `bun run ios:build`, open the app in the
  simulator, then `xcrun simctl openurl booted "$(bun run auth:link --ios
--server http://localhost:3000 2>/dev/null | tail -1)"` and tap Open.
- The task "Look over the Bloom iPhone app" is real and due tomorrow.
