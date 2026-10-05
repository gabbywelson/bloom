import { Schema } from "effect";

/** Kind of agent run. Model routing is a static table keyed by this value. */
export const RunType = Schema.Literals([
  "conversation",
  "triage",
  "plan",
  "summarize",
  "side_thread",
]);
export type RunType = typeof RunType.Type;
