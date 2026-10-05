import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";

/** Liveness response. `time` is a `DateTime.Utc` in TypeScript and an ISO string on the wire. */
export const HealthStatus = Schema.Struct({
  status: Schema.Literal("ok"),
  service: Schema.Literal("bloom-server"),
  time: Schema.DateTimeUtcFromString,
}).annotate({ identifier: "HealthStatus" });
export type HealthStatus = typeof HealthStatus.Type;

/** Public group (no `Authorization`): `GET /api/health`. */
export class HealthGroup extends HttpApiGroup.make("health")
  .add(
    HttpApiEndpoint.get("check", "/health", { success: HealthStatus }).annotateMerge(
      OpenApi.annotations({
        summary: "Liveness check",
        description: "Reports that the server is up and returns its current time.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Health",
      description: "Unauthenticated liveness endpoint.",
    }),
  ) {}
