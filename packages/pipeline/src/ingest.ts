/**
 * Names for the events Bloom raises about itself. Producers call
 * `EventSink.ingest` from `@bloom/domain` directly; it is already the single
 * entry point of the pipeline. A pipeline-level wrapper returns when the Triage
 * stage gives it work to do (for example enqueueing triage after `Inserted`).
 */

/** Producer name for events Bloom raises about itself (timers, lifecycle). */
export const SYSTEM_SOURCE = "system";

/** Event types the `system` source emits today. Add a name when the code that emits it lands. */
export const EventTypes = {
  /** Scheduler liveness tick (one per five minutes, deduped per minute). */
  heartbeat: "heartbeat",
} as const;
export type EventType = (typeof EventTypes)[keyof typeof EventTypes];
