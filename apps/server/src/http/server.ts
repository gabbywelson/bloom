/**
 * The HTTP server: API, docs, Better Auth and static routes on one Bun server.
 * CORS stays off (ADR 0004). `HttpRouter.serve` adds the request logger and
 * tracer middleware, so every request is a span with path-only logs, except
 * the magic-link verify request, whose span would carry the token.
 */
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpMiddleware, HttpRouter, HttpServer, type HttpServerRequest } from "effect/http";
import type { SocketAddress } from "effect/net/NetAddress";
import { AUTH_BASE_PATH } from "../auth/auth.ts";
import { AuthRoutes } from "../auth/routes.ts";
import { ServerConfig } from "../config.ts";
import { ApiRoutes, DocsRoute } from "./api.ts";
import { StaticRoutes } from "./static.ts";

/** Every route the server mounts, in one router. Wildcards lose to static/param routes, so `/api/*` always wins. */
export const AllRoutes = Layer.mergeAll(ApiRoutes, DocsRoute, AuthRoutes, StaticRoutes);

/** The magic-link verify endpoint; its `?token=` is a one-time credential (ADR 0003). */
export const MAGIC_LINK_VERIFY_PATH = `${AUTH_BASE_PATH}/magic-link/verify`;

/**
 * Requests that must never become an `http.server` span. The tracer middleware
 * records `url.full` and `url.query` verbatim, which would export the magic-link
 * token to the trace backend; the request logger only logs the path, so it stays on.
 */
export const isTracerDisabledFor = (request: HttpServerRequest.HttpServerRequest): boolean =>
  request.url === MAGIC_LINK_VERIFY_PATH || request.url.startsWith(`${MAGIC_LINK_VERIFY_PATH}?`);

/** `HttpMiddleware.TracerDisabledWhen` set to {@link isTracerDisabledFor}. */
export const TracerDisabledLive = Layer.succeed(HttpMiddleware.TracerDisabledWhen)(
  isTracerDisabledFor,
);

/**
 * Serves `routes` on the current `HttpServer` with the server's middleware
 * policy: request logger on, listen log off, tracer disabled for the verify path.
 */
export const serveRoutes = <A, E, R>(routes: Layer.Layer<A, E, R>) =>
  HttpRouter.serve(routes, { disableListenLog: true }).pipe(Layer.provide(TracerDisabledLive));

const describeAddress = (address: SocketAddress): string =>
  address._tag === "UnixPathAddress" ? address.path : `:${address.port}`;

/** One line once the socket is bound: `bloom-server listening on :3000`. */
export const ListenLog = Layer.effectDiscard(
  Effect.flatMap(HttpServer.HttpServer, (server) =>
    Effect.logInfo(`bloom-server listening on ${describeAddress(server.address)}`),
  ),
);

/**
 * Routes served on whatever `HttpServer` is provided (the integration test
 * binds a random port). The listen line is logged after the routes are mounted.
 */
export const HttpRoutesLive = ListenLog.pipe(Layer.provideMerge(serveRoutes(AllRoutes)));

/**
 * Bun closes a connection that sends nothing for `idleTimeout` seconds (default
 * 10). A chat reply streams nothing while the model thinks, which is routinely
 * longer than that, so the SSE response would be cut off and the run
 * interrupted. 255 is Bun's maximum.
 */
export const IDLE_TIMEOUT_SECONDS = 255;

/** Bun server bound to `PORT` on all interfaces (Tailscale reaches it by hostname). */
export const BunServerLive = Layer.unwrap(
  Effect.map(ServerConfig, (config) =>
    BunHttpServer.layer({
      port: config.port,
      hostname: "0.0.0.0",
      idleTimeout: IDLE_TIMEOUT_SECONDS,
    }),
  ),
);

/** The whole HTTP side. Exposes `HttpServer` so callers can read the bound address. */
export const HttpLive = HttpRoutesLive.pipe(Layer.provideMerge(BunServerLive));
