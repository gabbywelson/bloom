import { Schema } from "effect";

/**
 * Data sensitivity tier. Controls what enters a model context by default:
 * `normal` always, `private` only when relevant, `restricted` only on explicit request.
 */
export const SensitivityTier = Schema.Literals(["normal", "private", "restricted"]);
export type SensitivityTier = typeof SensitivityTier.Type;
