# 0021. HealthKit: one private daily summary per day, posted as an Event

Date: 2026-10-05

## Context

Apple Health is the first "deep context" source (VISION goal 4) and only the
phone can read it. The brief puts it in Phase 3 with the iOS shell. Health
data is `private` tier: it may inform Bloom only when the user's question
needs it, and this phase has no context assembly that could make that call.

## Decision

- **Ingest endpoint.** `POST /api/events` takes the encoded `EventIngest`
  (source, type, ISO `occurredAt`, JSON payload, optional `dedupeKey`) and
  hands it to `EventSink.ingest`. It answers a tagged result: `Inserted` with
  the event, or `Duplicate` with the key (both 200). The sources `domain` and
  `system` are reserved for the server and answer 400, so a client cannot
  forge audit events. The handler annotates its span with source and type
  only; payloads are never logged.
- **What the phone sends.** For each of the last 7 completed days (never
  today: its numbers are still growing, and the first summary of a day
  wins), one event `source: "healthkit"`, `type: "daily_summary"`,
  `dedupeKey: "healthkit:<yyyy-MM-dd>"`, `occurredAt` = local midnight, and
  payload `{ day, timeZone, steps?, sleepMinutes?, restingHeartRate? }`.
  Days with no data send nothing.
- **How the numbers are made.** Steps and resting heart rate come from
  HealthKit statistics queries (cumulative sum, discrete average), which
  already de-duplicate across iPhone and Watch. Sleep is the asleep stages
  only (no in-bed, no awake) in the 24 hours ending at noon, so a night
  belongs to the morning it ends; overlapping samples are merged before
  counting. The arithmetic is a pure function in BloomKit, unit-tested with
  fixtures, because the simulator has no Health data.
- **Opt-in.** Settings → Apple Health → "Share daily summaries" asks for read
  access to exactly the three types and turns syncing on. Sync runs when the
  app becomes active, at most every 6 hours. It is a no-op when Health is
  unavailable, when the toggle is off, or when there is no data; network
  failures retry next time.
- **Privacy.** The app never writes to Health. The events table now holds
  private-tier data, so no code may put `healthkit` events into a model
  context until context assembly filters by sensitivity tier (the brief's
  rule). Today nothing reads events into a prompt.

## Consequences

- The pipeline gets its first real client-originated events; triage can use
  them once it exists.
- If the Watch syncs late, a day's summary may be sent before its data is
  complete and the later, fuller numbers are dropped as duplicates.
  Acceptable for a daily signal; a `daily_summary_v2` with an
  update-in-place rule would fix it if it ever matters.
- Sleep attribution (noon to noon) is a choice; naps after noon count for the
  next day.
- Verified on the simulator: the real HealthKit permission sheet (three
  types, iOS 27's history step), then "Up to date." with no request sent.
  The posting path is covered by the summarizer tests and a curl check of
  `/api/events`.
