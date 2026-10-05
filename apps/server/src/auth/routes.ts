/**
 * Mounts Better Auth under `/api/auth/*` on the raw `HttpRouter`. Requests are
 * handed over as Web `Request`s (the Bun server already has one, so bodies
 * stream through untouched) and the Web `Response` is converted back.
 */
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { AUTH_BASE_PATH } from "./auth.ts";
import { Auth } from "./service.ts";

export const AUTH_ROUTE_PATTERN = `${AUTH_BASE_PATH}/*` as const;

export const AuthRoutes = HttpRouter.use(
  Effect.fn("AuthRoutes")(function* (router) {
    const auth = yield* Auth;
    yield* router.add("*", AUTH_ROUTE_PATTERN, (request) =>
      HttpServerRequest.toWeb(request).pipe(
        Effect.flatMap(auth.handle),
        Effect.map(HttpServerResponse.fromWeb),
        Effect.catch((error) =>
          Effect.logError("auth request failed").pipe(
            Effect.annotateLogs({ "bloom.auth.error": error._tag }),
            Effect.as(HttpServerResponse.empty({ status: 500 })),
          ),
        ),
        Effect.withSpan("auth.handle"),
      ),
    );
  }),
);
