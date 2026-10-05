/**
 * `BloomApi` served by `HttpApiBuilder`: every group's handlers plus the
 * `Authorization` implementation, with the OpenAPI document and Scalar docs
 * under `/api` so a single origin serves everything (ADR 0004).
 */
import { BloomApi } from "@bloom/api";
import { Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api";
import { AuthorizationLive } from "../auth/authorization.ts";
import { HealthLive } from "./groups/health.ts";
import { MeLive } from "./groups/me.ts";
import { MessagesLive } from "./groups/messages.ts";
import { TasksLive } from "./groups/tasks.ts";
import { ThreadsLive } from "./groups/threads.ts";

export const OPENAPI_PATH = "/api/openapi.json";
export const DOCS_PATH = "/api/docs";

/** All five groups; `Authorization` is merged in because the HTTP pipeline resolves it when the routes are built. */
export const GroupsLive = Layer.mergeAll(
  HealthLive,
  MeLive,
  ThreadsLive,
  MessagesLive,
  TasksLive,
).pipe(Layer.provideMerge(AuthorizationLive));

/** The API routes plus `GET /api/openapi.json`. */
export const ApiRoutes = HttpApiBuilder.layer(BloomApi, { openapiPath: OPENAPI_PATH }).pipe(
  Layer.provide(GroupsLive),
);

/** Scalar API reference at `GET /api/docs`. */
export const DocsRoute = HttpApiScalar.layer(BloomApi, { path: DOCS_PATH });
