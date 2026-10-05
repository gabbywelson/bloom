import { Schema } from "effect";

/** Who performed a domain mutation; recorded for the audit trail. */
export const Actor = Schema.Literals(["user", "agent", "system"]);
export type Actor = typeof Actor.Type;
