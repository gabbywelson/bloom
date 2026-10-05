import { BloomApi } from "@bloom/api";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

/** `GET /api/health`: public liveness; the only route without `Authorization`. */
export const HealthLive = HttpApiBuilder.group(BloomApi, "health", (handlers) =>
  handlers.handle("check", () =>
    Effect.map(DateTime.now, (time) => ({
      status: "ok" as const,
      service: "bloom-server" as const,
      time,
    })),
  ),
);
