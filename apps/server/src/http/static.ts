/**
 * Production single-origin serving (ADR 0004): when the SvelteKit static build
 * exists at `webDist`, it is the catch-all for every non-`/api` GET with an SPA
 * fallback to `200.html`. Without the build directory (dev, where Vite serves
 * the app) nothing is mounted and one line says so.
 */
import { Effect, FileSystem, Layer, Path } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { ServerConfig } from "../config.ts";

/** SvelteKit adapter-static fallback page name. */
export const SPA_INDEX = "200.html";

const isApiPath = (url: string): boolean => url === "/api" || url.startsWith("/api/");

export const StaticRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(config.webDist);
    const exists = yield* fs.exists(root).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      yield* Effect.logInfo("web build not found; static files are not served").pipe(
        Effect.annotateLogs({ "bloom.web_dist": root }),
      );
      return Layer.empty;
    }
    yield* Effect.logInfo("serving web build").pipe(
      Effect.annotateLogs({ "bloom.web_dist": root }),
    );
    return HttpRouter.use(
      Effect.fn("StaticRoutes")(function* (router) {
        const serve = yield* HttpStaticServer.make({ root, spa: true, index: SPA_INDEX });
        // Static and parametric routes always beat the wildcard, so `/api/*`
        // handlers win; this guard only keeps unknown `/api` paths from
        // answering with the SPA shell.
        yield* router.add(
          "GET",
          "/*",
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            if (isApiPath(request.url)) {
              return HttpServerResponse.empty({ status: 404 });
            }
            return yield* serve;
          }).pipe(Effect.catch(HttpServerRespondable.toResponse)),
        );
      }),
    );
  }),
);
