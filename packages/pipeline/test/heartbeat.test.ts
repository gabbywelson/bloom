import { describe, expect, it } from "bun:test";
import { EventSink, type IngestResult } from "@bloom/domain";
import { Clock, Cron, DateTime, Effect, Layer, Ref, Result } from "effect";
import { heartbeatDedupeKey, heartbeatJob, minuteBucket, scheduledJobs } from "../src/index.ts";

/**
 * A Clock whose wall time the test controls. Scheduling (`sleep`) and monotonic
 * time are delegated to the live clock; only what `DateTime.now` reads moves.
 */
const settableClock = (time: { millis: number }) =>
  Layer.effect(
    Clock.Clock,
    Clock.clockWith((live) =>
      Effect.succeed<Clock.Clock>({
        currentTimeMillisUnsafe: () => time.millis,
        currentTimeMillis: Effect.sync(() => time.millis),
        currentTimeNanosUnsafe: () => BigInt(time.millis) * 1_000_000n,
        currentTimeNanos: Effect.sync(() => BigInt(time.millis) * 1_000_000n),
        monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
        monotonicTimeNanos: live.monotonicTimeNanos,
        sleep: (duration) => live.sleep(duration),
      }),
    ),
  );

/** Wraps `EventSink.layerMemory` and records every `IngestResult` so the test can see what the job did. */
const recordingSink = (results: Ref.Ref<ReadonlyArray<IngestResult>>) =>
  Layer.effect(
    EventSink,
    Effect.gen(function* () {
      const inner = yield* EventSink;
      return EventSink.of({
        ingest: (input) =>
          inner
            .ingest(input)
            .pipe(Effect.tap((result) => Ref.update(results, (all) => [...all, result]))),
      });
    }),
  ).pipe(Layer.provide(EventSink.layerMemory));

const t0 = DateTime.makeUnsafe("2026-10-04T18:30:12.345Z");

describe("heartbeatJob", () => {
  it("is registered with a valid five-field cron", () => {
    expect(scheduledJobs).toContain(heartbeatJob);
    expect(heartbeatJob.name).toBe("heartbeat");
    expect(heartbeatJob.cron).toBe("*/5 * * * *");
    for (const job of scheduledJobs) {
      expect(Result.isSuccess(Cron.parse(job.cron))).toBe(true);
    }
  });

  it("buckets the dedupe key to the UTC minute", () => {
    expect(minuteBucket(t0)).toBe("2026-10-04T18:30Z");
    expect(heartbeatDedupeKey(t0)).toBe("heartbeat:2026-10-04T18:30Z");
    expect(heartbeatDedupeKey(DateTime.makeUnsafe("2026-10-04T18:30:59.999Z"))).toBe(
      heartbeatDedupeKey(t0),
    );
    expect(heartbeatDedupeKey(DateTime.makeUnsafe("2026-10-04T18:31:00.000Z"))).not.toBe(
      heartbeatDedupeKey(t0),
    );
  });

  it("writes exactly one event per minute bucket", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const time = { millis: DateTime.toEpochMillis(t0) };
        const results = yield* Ref.make<ReadonlyArray<IngestResult>>([]);
        const layer = Layer.mergeAll(settableClock(time), recordingSink(results));

        const program = Effect.gen(function* () {
          yield* heartbeatJob.run;
          yield* heartbeatJob.run;
          yield* Effect.sync(() => {
            time.millis += 45_000;
          });
          yield* heartbeatJob.run;
          yield* Effect.sync(() => {
            time.millis += 60_000;
          });
          yield* heartbeatJob.run;
        });
        yield* program.pipe(Effect.provide(layer));

        const all = yield* Ref.get(results);
        expect(all.map((result) => result._tag)).toEqual([
          "Inserted",
          "Duplicate",
          "Duplicate",
          "Inserted",
        ]);

        const first = all[0];
        if (first === undefined || first._tag !== "Inserted") {
          throw new Error("expected the first run to insert");
        }
        expect(first.event.source).toBe("system");
        expect(first.event.type).toBe("heartbeat");
        expect(first.event.dedupeKey).toBe("heartbeat:2026-10-04T18:30Z");
        expect(DateTime.formatIso(first.event.occurredAt)).toBe("2026-10-04T18:30:12.345Z");
        expect(first.event.payload).toEqual({
          pid: process.pid,
          uptimeSeconds: expect.any(Number),
        });

        const last = all[3];
        if (last === undefined || last._tag !== "Inserted") {
          throw new Error("expected the fourth run to insert");
        }
        expect(last.event.dedupeKey).toBe("heartbeat:2026-10-04T18:31Z");
      }),
    );
  });
});
