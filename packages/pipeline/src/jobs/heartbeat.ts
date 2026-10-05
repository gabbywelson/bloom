import { EventSink } from "@bloom/domain";
import { DateTime, Effect } from "effect";
import { EventTypes, SYSTEM_SOURCE } from "../ingest.ts";
import { defineJob } from "./job.ts";

/** Truncates an instant to its UTC minute, e.g. `2026-10-04T18:30Z`. */
export const minuteBucket = (at: DateTime.Utc): string => `${DateTime.formatIso(at).slice(0, 16)}Z`;

/** Dedupe key for a heartbeat: one event per minute no matter how often the job runs. */
export const heartbeatDedupeKey = (at: DateTime.Utc): string =>
  `${EventTypes.heartbeat}:${minuteBucket(at)}`;

/**
 * Liveness tick. Proves the scheduler and the event pipeline are wired end to
 * end; the payload is enough to tell restarts apart in the debug view.
 */
export const heartbeatJob = defineJob<EventSink>({
  name: "heartbeat",
  cron: "*/5 * * * *",
  description: "Writes a system heartbeat event every five minutes (deduped per minute).",
  run: Effect.gen(function* () {
    const sink = yield* EventSink;
    const now = yield* DateTime.now;
    const { pid, uptimeSeconds } = yield* Effect.sync(() => ({
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
    }));
    const result = yield* sink.ingest({
      source: SYSTEM_SOURCE,
      type: EventTypes.heartbeat,
      occurredAt: now,
      payload: { pid, uptimeSeconds },
      dedupeKey: heartbeatDedupeKey(now),
    });
    yield* Effect.logDebug("heartbeat").pipe(
      Effect.annotateLogs({
        job: "heartbeat",
        result: result._tag,
        dedupeKey: heartbeatDedupeKey(now),
      }),
    );
  }).pipe(Effect.withSpan("job.heartbeat")),
});
