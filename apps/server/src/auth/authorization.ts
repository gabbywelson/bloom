/**
 * Implementation of the `Authorization` middleware declared in `@bloom/api`:
 * resolves the Better Auth session cookie and provides `CurrentUser` to the
 * wrapped handler, or fails with `Unauthorized` (HTTP 401).
 */
import { Authorization, CurrentUser, Unauthorized } from "@bloom/api";
import { UserId } from "@bloom/domain";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import { Auth } from "./service.ts";

const decodeUserId = Schema.decodeSync(UserId);

/** What the client sees; deliberately free of detail. */
export const SIGN_IN_MESSAGE = "Please sign in.";

/**
 * Only the `cookie` header reaches Better Auth; nothing from it is logged. A
 * future bearer-token flow for iOS would forward `authorization` here too.
 */
export const sessionHeaders = (request: HttpServerRequest.HttpServerRequest): Headers => {
  const headers = new Headers();
  const cookie = request.headers["cookie"];
  if (cookie !== undefined) {
    headers.set("cookie", cookie);
  }
  return headers;
};

export const AuthorizationLive: Layer.Layer<Authorization, never, Auth> = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const auth = yield* Auth;
    return Authorization.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* auth
          .getSession(sessionHeaders(request))
          .pipe(
            Effect.catchTag("AuthError", (error) =>
              Effect.logWarning("session lookup failed").pipe(
                Effect.annotateLogs({ "bloom.auth.operation": error.operation }),
                Effect.andThen(Effect.fail(new Unauthorized({ message: SIGN_IN_MESSAGE }))),
              ),
            ),
          );
        if (Option.isNone(session)) {
          return yield* new Unauthorized({ message: SIGN_IN_MESSAGE });
        }
        const { user } = session.value;
        yield* Effect.annotateCurrentSpan("bloom.user_id", user.id);
        return yield* Effect.provideService(httpEffect, CurrentUser, {
          id: decodeUserId(user.id),
          email: user.email,
          name: user.name,
        });
      }).pipe(Effect.withSpan("auth.session")),
    );
  }),
);
