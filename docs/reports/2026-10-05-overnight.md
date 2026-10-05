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
- Live: server on :3101, `bun run auth:link --ios --server
http://localhost:3101`, opened in the iPhone 17 (iOS 27.0) simulator →
  server log `GET /api/auth/magic-link/verify` 302, `GET /api/me` 200 →
  "You're signed in", Settings shows the owner and server. `grep -c token=`
  on the server log: 0.

**Incident: OrbStack stall, and a stray compose project (cleaned up)**

- At 22:20 Postgres stopped answering (even `pg_isready` hung): the ADR 0010
  stall. Ran `orb stop && orb start`, then `docker compose up -d postgres
otel-collector jaeger` as instructed. From a git worktree that command
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

## Morning checklist

- Langfuse is stopped (see incident); `bun run infra:up:langfuse` restores it.
- Bundle id prefix is a placeholder (`dev.bloom` in `apps/ios/project.yml`);
  set it and `DEVELOPMENT_TEAM` before running on a phone.
