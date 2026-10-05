/**
 * @bloom/integrations: one module per external source. Each exposes agent
 * tools and/or an ingestion Layer that emits Events via `@bloom/domain`.
 * Never imports `@bloom/agent`.
 */
import type { Integration } from "./integration.ts";

export * from "./integration.ts";

/**
 * Every integration apps/server should mount. Order is not significant.
 * Empty until the first external source (Google Calendar, phase 2) lands;
 * Bloom's own timers live in `@bloom/pipeline`, not here.
 */
export const integrations: ReadonlyArray<Integration> = [];
