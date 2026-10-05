import { describe, expect, it } from "bun:test";
import { EventSink, type IngestResult } from "@bloom/domain";
import { heartbeatJob, type ScheduledJob, scheduledJobs } from "@bloom/pipeline";
import { Effect, Layer, Ref } from "effect";
import { type Boss, type BossJob, registerJobs } from "../src/jobs/scheduler.ts";

interface Recorded {
  readonly getQueue: Array<string>;
  readonly createQueue: Array<string>;
  readonly schedule: Array<{ name: string; cron: string; singletonKey: string }>;
  readonly work: Array<{ name: string; batchSize: number }>;
  readonly send: Array<{ name: string; singletonKey: string }>;
  readonly handlers: Map<string, (jobs: ReadonlyArray<BossJob>) => Promise<void>>;
}

/** A `Boss` that records every call; `existing` names answer `getQueue` with a queue. */
const fakeBoss = (existing: ReadonlySet<string>): { boss: Boss; recorded: Recorded } => {
  const recorded: Recorded = {
    getQueue: [],
    createQueue: [],
    schedule: [],
    work: [],
    send: [],
    handlers: new Map(),
  };
  const boss: Boss = {
    getQueue: async (name) => {
      recorded.getQueue.push(name);
      return existing.has(name) ? { name } : null;
    },
    createQueue: async (name) => {
      recorded.createQueue.push(name);
    },
    schedule: async (name, cron, _data, options) => {
      recorded.schedule.push({ name, cron, singletonKey: options.singletonKey });
    },
    work: async (name, options, handler) => {
      recorded.work.push({ name, batchSize: options.batchSize });
      recorded.handlers.set(name, handler);
      return `worker-${name}`;
    },
    send: async (name, _data, options) => {
      recorded.send.push({ name, singletonKey: options.singletonKey });
      return `job-${name}`;
    },
  };
  return { boss, recorded };
};

/** `EventSink.layerMemory` plus a record of every `IngestResult`. */
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

const register = (boss: Boss, jobs: ReadonlyArray<ScheduledJob<EventSink>>, runOnStart: boolean) =>
  Effect.gen(function* () {
    const results = yield* Ref.make<ReadonlyArray<IngestResult>>([]);
    yield* Effect.gen(function* () {
      const context = yield* Effect.context<EventSink>();
      yield* registerJobs(boss, jobs, context, { runOnStart });
    }).pipe(Effect.provide(recordingSink(results)));
    return results;
  });

describe("JobScheduler.registerJobs", () => {
  it("creates missing queues once, schedules each cron under a singleton key and starts one worker", async () => {
    const { boss, recorded } = fakeBoss(new Set());
    await Effect.runPromise(register(boss, scheduledJobs, false));

    const names = scheduledJobs.map((job) => job.name);
    expect(recorded.getQueue).toEqual(names);
    expect(recorded.createQueue).toEqual(names);
    expect(recorded.schedule).toEqual(
      scheduledJobs.map((job) => ({ name: job.name, cron: job.cron, singletonKey: job.name })),
    );
    expect(recorded.work).toEqual(names.map((name) => ({ name, batchSize: 1 })));
    expect(recorded.send).toEqual([]);
  });

  it("does not recreate a queue that already exists", async () => {
    const { boss, recorded } = fakeBoss(new Set(["heartbeat"]));
    await Effect.runPromise(register(boss, [heartbeatJob], false));
    expect(recorded.getQueue).toEqual(["heartbeat"]);
    expect(recorded.createQueue).toEqual([]);
    expect(recorded.schedule).toHaveLength(1);
  });

  it("enqueues every job once at startup when asked", async () => {
    const { boss, recorded } = fakeBoss(new Set());
    await Effect.runPromise(register(boss, [heartbeatJob], true));
    expect(recorded.send).toEqual([{ name: "heartbeat", singletonKey: "heartbeat:run-on-start" }]);
  });

  it("runs job.run through the captured runtime and writes an Event via EventSink", async () => {
    const { boss, recorded } = fakeBoss(new Set());
    const results = await Effect.runPromise(register(boss, [heartbeatJob], false));
    const handler = recorded.handlers.get("heartbeat");
    expect(handler).toBeDefined();
    if (handler === undefined) {
      return;
    }
    await handler([{ id: "job-1", name: "heartbeat" }]);
    await handler([{ id: "job-2", name: "heartbeat" }]);

    const all = await Effect.runPromise(Ref.get(results));
    expect(all.map((result) => result._tag)).toEqual(["Inserted", "Duplicate"]);
    const first = all[0];
    if (first?._tag === "Inserted") {
      expect(first.event.source).toBe("system");
      expect(first.event.type).toBe("heartbeat");
    }
  });

  it("swallows a job defect so pg-boss does not retry it", async () => {
    const { boss, recorded } = fakeBoss(new Set());
    const dying: ScheduledJob<EventSink> = {
      name: "dying",
      cron: "* * * * *",
      description: "always dies",
      run: Effect.die(new Error("boom")),
    };
    await Effect.runPromise(register(boss, [dying], false));
    const handler = recorded.handlers.get("dying");
    if (handler === undefined) {
      throw new Error("worker not registered");
    }
    const outcome = await handler([{ id: "job-1", name: "dying" }]);
    expect(outcome).toBeUndefined();
  });
});
