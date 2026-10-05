import { OpenApi } from "effect/http-api";
import { BloomApi } from "./api.ts";

/** The OpenAPI 3.1 document for `BloomApi` (a fresh copy on each call). */
export const openApiSpec = (): OpenApi.OpenAPISpec => OpenApi.fromApi(BloomApi);

/** `openApiSpec()` as pretty-printed JSON with a trailing newline, the content of `packages/api/openapi.json`. */
export const renderOpenApiJson = (): string => `${JSON.stringify(openApiSpec(), null, 2)}\n`;
