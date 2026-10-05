import { HttpApi, OpenApi } from "effect/http-api";
import { HealthGroup } from "./groups/health.ts";
import { MeGroup } from "./groups/me.ts";
import { MessagesGroup } from "./groups/messages.ts";
import { TasksGroup } from "./groups/tasks.ts";
import { ThreadsGroup } from "./groups/threads.ts";
import { bloomOpenApiTransform } from "./openapi-transform.ts";

/**
 * The Bloom HTTP API: single source of truth for server handlers
 * (`HttpApiBuilder`), the web client (`HttpApiClient`) and `openapi.json`.
 *
 * Every route lives under `/api` (ADR 0004). `/api/auth/*` belongs to Better
 * Auth and is deliberately not part of this contract.
 */
export class BloomApi extends HttpApi.make("bloom")
  .add(HealthGroup, MeGroup, ThreadsGroup, MessagesGroup, TasksGroup)
  .prefix("/api")
  .annotateMerge(
    OpenApi.annotations({
      title: "Bloom API",
      version: "0.1.0",
      description:
        "HTTP contract of the Bloom personal agent. Authenticated routes rely on the Better Auth session cookie; chat replies stream as Server-Sent Events.",
      transform: bloomOpenApiTransform,
    }),
  ) {}
