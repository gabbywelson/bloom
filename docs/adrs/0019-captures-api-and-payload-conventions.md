# 0019. Captures API: one free-form payload, conventional shapes, audited without content

Date: 2026-10-05

## Context

`Capture` existed in the domain (kind text/voice/share/image, payload,
transcript, status, routedTo) with a table, but no service or API. The iOS
share sheet, a quick-capture field and later App Intents all need to file
captures, and triage (not built yet) needs to list and route them.

Open questions: how strictly to type `payload`, where images go before there
is blob storage, and what the audit log should contain.

## Decision

- **Service.** `CaptureService` in `@bloom/domain` (`create`, `list` with a
  status filter, `get`, `update`) with `layerMemory`; `CaptureServiceDb` in
  `@bloom/db`. Each mutation runs in one transaction with an audit `Event`
  (`capture.created`, `capture.updated`; `source: "domain"`), the same
  pattern as tasks. The event carries the capture id, kind, actor and the
  triage patch, never the payload: it can be a whole photo, and the events
  table is read by the pipeline.
- **API.** A `captures` group: `POST /api/captures` (payload is the encoded
  side of `Capture.jsonCreate`, so only `kind` and `payload` are required;
  status defaults to `new`), `GET /api/captures?status=new`,
  `GET /api/captures/:id`, `PATCH /api/captures/:id` (`status`, `routedTo`,
  `transcript`; `kind` and `payload` are write-once). All behind
  `Authorization`, like every group but health.
- **Payload stays `Schema.Json`.** Clients use these shapes by convention,
  documented on the endpoint and in `capture.ts`:
  - text: `{ text }`
  - share: `{ url?, title?, text? }`
  - image: `{ dataUrl, width, height, caption? }`
  - voice: `{ dataUrl, durationSeconds }` (no client yet)

  A typed union would be stricter, but triage is the only consumer and does
  not exist yet; tightening later is a schema change plus a data check.

- **Images inline, for now.** An image capture carries a JPEG data URL,
  downscaled by the client (longest side 1600 px, quality 0.7, typically
  200–400 KB). One user, a few images a day: Postgres copes. Move to blob
  storage (and a URL in the payload) once captures are routed somewhere that
  needs the original.
- **Repair migration.** Writing the integration tests showed `bloom_test`
  had no `seq` on `captures` and `nudges`: it ran 0002 before ADR 0012 edited
  it in place. `0003_ordering_repair` adds the missing columns and indexes
  idempotently (a no-op on databases migrated later) and drops the superseded
  `nudges_created_at_id_idx`. Migrations stay append-only from here.

## Consequences

- Any client can file a capture with one call; nothing routes them yet, so
  they accumulate as `new` until triage exists (or the user dismisses them).
- A malformed payload of a known kind is accepted. Triage must treat payload
  fields as optional.
- Large images make `GET /api/captures` responses heavy. The iOS list only
  asks for `status=new`; a lighter list shape (no payload) is the next step if
  that ever hurts.
