import { Context, type Effect, Layer } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { BloomApi } from "./api.ts";

/** Options for the derived client. */
export interface BloomClientOptions {
  /**
   * Origin to prepend to every request, e.g. `http://localhost:3000`.
   * Omit it in the browser: paths already start with `/api` and resolve
   * against `location.origin` (ADR 0004, single origin).
   */
  readonly baseUrl?: string | URL | undefined;
}

/** The typed client shape derived from `BloomApi`. SSE endpoints return a `Stream`. */
export type BloomClientShape = HttpApiClient.ForApi<typeof BloomApi>;

/**
 * Builds the typed client from the API definition. Requires an `HttpClient`
 * (e.g. `FetchHttpClient.layer`); use `BloomClient.layer` for the ready-made
 * service.
 */
export const makeBloomClient = (
  options?: BloomClientOptions,
): Effect.Effect<BloomClientShape, never, HttpClient.HttpClient> =>
  HttpApiClient.make(BloomApi, { baseUrl: options?.baseUrl });

/**
 * The Bloom API client as a service, so the web app can `yield* BloomClient`.
 * `BloomClient.layer()` provides `FetchHttpClient`; the browser attaches the
 * session cookie itself, so no client middleware is required.
 */
export class BloomClient extends Context.Service<BloomClient, BloomClientShape>()(
  "bloom/api/BloomClient",
) {
  static readonly layer = (baseUrl?: string | URL): Layer.Layer<BloomClient> =>
    Layer.effect(BloomClient, makeBloomClient({ baseUrl })).pipe(
      Layer.provide(FetchHttpClient.layer),
    );
}
