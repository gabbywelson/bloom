# 0017. The Swift client is generated from openapi.json; only SSE framing is hand-written

Date: 2026-10-05

## Context

ADR 0007 made `packages/api/openapi.json` the contract for the future Swift
client. Building that client raised four questions: how to generate it, what
to do about the streaming chat endpoint, and two problems with the document
Effect emits.

- Effect inlines every schema. A generated client would name types after
  operations (`Operations.tasks_list.Output.Ok.Body.jsonPayload`).
- Effect writes `Schema.NullOr(X)` as `anyOf: [X, { "type": "null" }]`.
  swift-openapi-generator 1.13 rejects the bare `null` member and silently
  drops the whole property, so `Task` came out without `notes`, `due`,
  `effort`, and every other nullable field.
- The SSE endpoint is described as an envelope (`{ id, event, data }` with
  `data` a JSON string). `ChatStreamEvent` does not appear in the document.
- Tagged unions are `anyOf`. The generator turns those into structs of
  optionals; it emits a real enum only for `oneOf` with a `discriminator`.

## Decision

- **Generator.** Apple's swift-openapi-generator runs as an SPM build plugin
  on the `BloomKit` framework (`generate: [types, client]`, `public`,
  `namingStrategy: idiomatic`). `BloomKit/API/openapi.json` is a symlink to
  the committed document, so `bun run openapi` followed by an iOS build is
  the whole regeneration step. Package versions are pinned exactly in
  `project.yml` because the generated project, and its `Package.resolved`,
  are not committed. Command-line builds pass `-skipPackagePluginValidation`.
- **Better document, not a different one.** `BloomApi` carries an OpenAPI
  `transform` annotation (`packages/api/src/openapi-transform.ts`), so the
  committed file and `/api/openapi.json` stay identical:
  - wire schemas carry `identifier` annotations in `@bloom/domain`
    (`TaskStatus`, `MessagePart`, the stream events) and the API uses named
    `json` variants (`TaskJson` → `Task`, `TaskCreate`, `TaskUpdate`, ...);
  - `ChatStreamEvent` and its members are added as components, and the SSE
    `data` schema points at them with `contentSchema`;
  - tagged unions become `oneOf` + `discriminator` mappings;
  - `anyOf [X, null]` becomes `X` with `"null"` added to `type` (and `enum`),
    the conventional 3.1 form. A nullable `$ref` to a primitive is inlined to
    get there; a nullable `$ref` to an object is left alone (none exists).

  Every rewrite is semantically equivalent JSON Schema. Tests assert the
  names, the discriminators, that no bare `null` schema remains, that the
  standalone stream definitions agree with the endpoint ones, and that the
  committed file is current.

- **SSE.** The generator represents the endpoint (`text/event-stream` as a
  raw `HTTPBody`), so the request goes through the generated client like
  every other call. Only event framing is hand-written: `ChatStream.events`
  parses SSE with OpenAPIRuntime's decoder and decodes each `data` line into
  the generated `ChatStreamEvent` enum. It stops after the first terminal
  event (`message_end` or `error`), skips unknown event types so a newer
  server cannot break an older app, fails on Effect's reserved
  `effect/http-api/stream/failure` event, and fails if the connection ends
  before a terminal event.
- **Recorded streams are shared.** `packages/api/test/fixtures/chat-stream/`
  holds real response bodies for three ADR 0013 runs (plain reply, tool
  round, model error). A bun test proves they are byte-identical to what
  the HttpApi SSE encoder produces; the Swift tests decode the same files,
  including byte-by-byte chunking and CRLF.
- **Facade.** `BloomAPI` wraps the generated `Client` in async methods that
  return the generated models and throw `BloomAPIError` (`unauthorized`,
  `notFound`, `badRequest`, `unreachable`, ...). Plain calls use a URLSession
  with a 20 s idle timeout; the chat stream uses a second one that tolerates
  two minutes of silence (the web's numbers, ADR 0016). There are no
  automatic retries: plain calls are cheap to repeat from the UI, and a chat
  turn must never be sent twice.

## Consequences

- Adding an endpoint is: add it to `packages/api`, `bun run openapi`, build
  the app, add a facade method. Renames are Swift compile errors.
- New nullable fields must be primitives (or unions the transform handles).
  `scripts/ios.sh` prints any "not supported … skipping" warning from the
  generator, because each one is a field missing from the Swift types.
- Integer query parameters are numeric strings on the wire (Effect encodes
  them that way); the facade converts.
- Generated method names follow operation ids (`tasks_list`); the facade
  hides them.
