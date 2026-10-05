import type { EventSink } from "@bloom/domain";
import { heartbeatJob } from "./heartbeat.ts";
import type { ScheduledJob } from "./job.ts";

export * from "./heartbeat.ts";
export * from "./job.ts";

/** Union of everything any scheduled job needs; apps/server provides it once. */
export type JobRequirements = EventSink;

/**
 * Every job the scheduler should register. pg-boss wiring (schedules, singleton
 * keys, retries) lives in apps/server; this list is the single source of truth
 * for what to register.
 */
export const scheduledJobs: ReadonlyArray<ScheduledJob<JobRequirements>> = [heartbeatJob];
