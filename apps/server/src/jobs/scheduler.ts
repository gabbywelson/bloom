/**
 * `JobScheduler`: pg-boss 12 running every `ScheduledJob` from `@bloom/pipeline`.
 *
 * The boss lives in its own `pgboss` schema of the same database. Each job gets
 * a queue (created once), a cron schedule keyed by its name, and one worker
 * that runs `job.run` through the Effect runtime captured when the Layer was
 * built, so jobs see the same `EventSink`, tracer and loggers as the server.
 */
import { type EventSink } from "@bloom/domain";
import { type ScheduledJob, scheduledJobs } from "@bloom/pipeline";
import { Config, Context, Duration, Effect, Layer, Redacted, Schema } from "effect";
import { PgBoss } from "pg-boss";
import { ServerConfig } from "../config.ts";

/** pg-boss rejected or threw. `cause` is the underlying error; payloads are never attached. */
export class SchedulerError extends Schema.TaggedError<SchedulerError>()("SchedulerError", {
  operation: Schema.Literals(["start", "getQueue", "createQueue", "schedule", "work", "send"]),
  job: Schema.optionalKey(Schema.String),
  cause: Schema.Defect(),
}) {}

/** A pg-boss job as the worker receives it; only the fields the scheduler reads. */
export interface BossJob {
  readonly id: string;
  readonly name: string;
}

/**
 * The slice of `PgBoss` the scheduler uses, so tests can substitute a fake.
 * `createQueue` is not idempotent in v12; `getQueue` is checked first.
 */
export interface Boss {
  readonly getQueue: (name: string) => Promise<unknown>;
  readonly createQueue: (name: string) => Promise<void>;
  readonly schedule: (
    name: string,
    cron: string,
    data: object | null,
    options: { readonly singletonKey: string },
  ) => Promise<void>;
  readonly work: (
    name: string,
    options: { readonly batchSize: number },
    handler: (jobs: ReadonlyArray<BossJob>) => Promise<void>,
  ) => Promise<string>;
  readonly send: (
    name: string,
    data: object | null,
    options: { readonly singletonKey: string },
  ) => Promise<string | null>;
}

/** Name of the Postgres schema pg-boss owns. */
export const PGBOSS_SCHEMA = "pgboss";
/** How long a graceful stop waits for in-flight jobs. */
export const STOP_TIMEOUT = Duration.seconds(10);
/**
 * Upper bound on the whole `stop` call. pg-boss honours `STOP_TIMEOUT` only for
 * the graceful wait; closing its pool afterwards can hang on a dead Postgres, and
 * shutdown must not wait for a stuck socket (CLAUDE.md: external calls get timeouts).
 */
export const STOP_DEADLINE = Duration.sum(STOP_TIMEOUT, Duration.seconds(5));
/** Set `BLOOM_JOBS_RUN_ON_START=true` to enqueue every job once at startup (smoke tests). */
export const RUN_ON_START = Config.Boolean("BLOOM_JOBS_RUN_ON_START").pipe(
  Config.withDefault(false),
);

const bossCall = <A>(
  operation: SchedulerError["operation"],
  job: string,
  run: () => Promise<A>,
): Effect.Effect<A, SchedulerError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new SchedulerError({ operation, job, cause }),
  }).pipe(Effect.timeoutOrElse({ duration: "30 seconds", orElse: () => timedOut(operation, job) }));

const timedOut = (operation: SchedulerError["operation"], job: string) =>
  Effect.fail(
    new SchedulerError({ operation, job, cause: new Error(`${operation} exceeded 30 seconds`) }),
  );

/**
 * Runs one job through the captured runtime: a `scheduler.run` span tagged with
 * the job name (the job itself owns the `job.<name>` span, see `@bloom/pipeline`),
 * a structured log line with the duration, never a payload. `job.run` cannot
 * fail by contract; a defect is logged and swallowed so pg-boss does not retry
 * a job that would only die again.
 */
export const runJob = <R>(job: ScheduledJob<R>, context: Context.Context<R>): Promise<void> =>
  Effect.runPromiseWith(context)(
    Effect.timed(job.run).pipe(
      Effect.flatMap(([duration]) =>
        Effect.logInfo("job completed").pipe(
          Effect.annotateLogs({
            "bloom.job": job.name,
            "bloom.job.ms": Duration.toMillis(duration),
          }),
        ),
      ),
      Effect.catchCause((cause) =>
        Effect.logError("job died").pipe(
          Effect.annotateLogs({ "bloom.job": job.name, "bloom.job.cause": String(cause) }),
        ),
      ),
      Effect.withSpan("scheduler.run", { attributes: { "bloom.job": job.name } }),
    ),
  );

/**
 * Registers `jobs` on `boss`: queue (once), cron schedule (singleton by name)
 * and worker. `context` is what the handlers run with.
 */
export const registerJobs = Effect.fn("JobScheduler.register")(function* <R>(
  boss: Boss,
  jobs: ReadonlyArray<ScheduledJob<R>>,
  context: Context.Context<R>,
  options: { readonly runOnStart: boolean },
) {
  for (const job of jobs) {
    const existing = yield* bossCall("getQueue", job.name, () => boss.getQueue(job.name));
    if (existing === null) {
      yield* bossCall("createQueue", job.name, () => boss.createQueue(job.name));
    }
    yield* bossCall("schedule", job.name, () =>
      boss.schedule(job.name, job.cron, null, { singletonKey: job.name }),
    );
    yield* bossCall("work", job.name, () =>
      boss.work(job.name, { batchSize: 1 }, async (batch) => {
        for (const _ of batch) {
          await runJob(job, context);
        }
      }),
    );
    yield* Effect.logInfo("job registered").pipe(
      Effect.annotateLogs({ "bloom.job": job.name, "bloom.job.cron": job.cron }),
    );
    if (options.runOnStart) {
      yield* bossCall("send", job.name, () =>
        boss.send(job.name, null, { singletonKey: `${job.name}:run-on-start` }),
      );
      yield* Effect.logInfo("job enqueued at startup").pipe(
        Effect.annotateLogs({ "bloom.job": job.name }),
      );
    }
  }
});

export interface JobSchedulerShape {
  /** Names of the jobs registered at startup. */
  readonly jobs: ReadonlyArray<string>;
}

export class JobScheduler extends Context.Service<JobScheduler, JobSchedulerShape>()(
  "bloom/server/JobScheduler",
) {
  static readonly layer: Layer.Layer<
    JobScheduler,
    SchedulerError | Config.ConfigError,
    ServerConfig | EventSink
  > = Layer.effect(
    JobScheduler,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const runOnStart = yield* RUN_ON_START.pipe(Config.withDefault(false));
      const context = yield* Effect.context<EventSink>();

      const boss = yield* Effect.acquireRelease(
        Effect.gen(function* () {
          const instance = new PgBoss({
            connectionString: Redacted.value(config.databaseUrl),
            schema: PGBOSS_SCHEMA,
            application_name: "bloom-jobs",
            openTelemetry: { enabled: false },
          });
          instance.on("error", (error) => {
            Effect.runForkWith(context)(
              Effect.logError("pg-boss error").pipe(
                Effect.annotateLogs({ "bloom.pgboss.error": error.message }),
              ),
            );
          });
          return yield* bossCall("start", "*", () => instance.start());
        }),
        (instance) =>
          Effect.promise(() =>
            instance.stop({ graceful: true, timeout: Duration.toMillis(STOP_TIMEOUT) }),
          ).pipe(
            Effect.timeoutOrElse({
              duration: STOP_DEADLINE,
              orElse: () => Effect.logWarning("pg-boss stop timed out; abandoning its pool"),
            }),
            Effect.catchCause(() => Effect.logWarning("pg-boss stop failed")),
            Effect.andThen(Effect.logInfo("pg-boss stopped")),
          ),
      );

      yield* registerJobs(boss, scheduledJobs, context, { runOnStart });
      yield* Effect.logInfo("pg-boss started").pipe(
        Effect.annotateLogs({ "bloom.jobs": scheduledJobs.length }),
      );
      return JobScheduler.of({ jobs: scheduledJobs.map((job) => job.name) });
    }),
  );
}
