import type { Effect } from "effect";

/**
 * A recurring background job. `cron` is a standard five-field expression
 * (minute hour day-of-month month day-of-week) as understood by pg-boss.
 * The scheduler (pg-boss in apps/server) owns execution; this package only
 * describes jobs, so `run` must handle its own failures and never fail.
 */
/**
 * A job's `run` is expected to open its own `job.<name>` span; the server's
 * scheduler wraps it in `scheduler.run` and does not add a second job span.
 */
export interface ScheduledJob<R = never> {
  readonly name: string;
  readonly cron: string;
  readonly description: string;
  readonly run: Effect.Effect<void, never, R>;
}

/** Identity helper that pins the job shape and infers its requirements. */
export const defineJob = <R = never>(job: ScheduledJob<R>): ScheduledJob<R> => job;
