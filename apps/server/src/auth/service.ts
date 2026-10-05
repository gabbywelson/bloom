/**
 * `Auth`: the Better Auth instance as an Effect service. Built inside a Layer
 * from `ServerConfig`; the `pg` Pool it owns is released with the Layer.
 * Promise APIs are wrapped in `Effect.tryPromise` and bounded by timeouts.
 */
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Pool } from "pg";
import { ServerConfig } from "../config.ts";
import { createAuth } from "./auth.ts";

/** Better Auth threw or timed out. `cause` never carries cookies or tokens. */
export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
  operation: Schema.Literals(["handle", "getSession", "requestMagicLink"]),
  cause: Schema.Defect(),
}) {}

/** The signed-in user as Better Auth stores it. */
export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface AuthShape {
  /** Routes a Web `Request` under `/api/auth/*` to Better Auth. */
  readonly handle: (request: Request) => Effect.Effect<Response, AuthError>;
  /** Resolves the session cookie in `headers`; `None` when there is no valid session. */
  readonly getSession: (
    headers: Headers,
  ) => Effect.Effect<Option.Option<{ readonly user: SessionUser }>, AuthError>;
  /** Asks Better Auth to issue a magic link for `email`; the link is delivered through `onMagicLink`. */
  readonly requestMagicLink: (email: string) => Effect.Effect<void, AuthError>;
}

/** Where an issued magic link goes. The server logs a notice; the CLI prints the URL. */
export interface AuthLayerOptions {
  readonly onMagicLink: (link: {
    readonly email: string;
    readonly url: string;
  }) => Effect.Effect<void>;
}

/** Better Auth answers session lookups from Postgres; anything slower than this is a fault. */
export const SESSION_TIMEOUT = "5 seconds";
/** Upper bound for one auth request (WebAuthn ceremonies included). */
export const HANDLE_TIMEOUT = "30 seconds";
/** How long shutdown waits for the pg pool to drain before abandoning it (a dead database must not block exit). */
export const POOL_CLOSE_TIMEOUT = "5 seconds";

/** Where the web app lands after a magic link signs the owner in (ADR 0003). */
export const MAGIC_LINK_CALLBACK_PATH = "/passkeys";
/** Where a failed magic link lands; the page reads `?error=<code>`. */
export const MAGIC_LINK_ERROR_PATH = "/login";

const timedOut = (operation: AuthError["operation"], duration: string) =>
  Effect.fail(new AuthError({ operation, cause: new Error(`${operation} exceeded ${duration}`) }));

export class Auth extends Context.Service<Auth, AuthShape>()("bloom/server/Auth") {
  /** Builds the service with a caller-supplied magic-link sink. */
  static readonly make = Effect.fn("Auth.make")(function* (options: AuthLayerOptions) {
    const config = yield* ServerConfig;
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => new Pool({ connectionString: Redacted.value(config.databaseUrl) })),
      (pool) =>
        Effect.promise(() => pool.end()).pipe(
          Effect.timeoutOrElse({
            duration: POOL_CLOSE_TIMEOUT,
            orElse: () => Effect.logWarning("auth: closing the pg pool timed out; abandoning it"),
          }),
          Effect.catchCause(() => Effect.logWarning("auth: closing the pg pool failed")),
        ),
    );
    const context = yield* Effect.context<never>();
    const auth = createAuth({
      database: pool,
      secret: Redacted.value(config.betterAuthSecret),
      webOrigin: config.webOrigin,
      rpId: config.passkeyRpId,
      rpName: config.passkeyRpName,
      onMagicLink: (link) => Effect.runPromiseWith(context)(options.onMagicLink(link)),
    });

    const handle = Effect.fn("Auth.handle")(function* (request: Request) {
      return yield* Effect.tryPromise({
        try: () => auth.handler(request),
        catch: (cause) => new AuthError({ operation: "handle", cause }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: HANDLE_TIMEOUT,
          orElse: () => timedOut("handle", HANDLE_TIMEOUT),
        }),
      );
    });

    const getSession = Effect.fn("Auth.getSession")(function* (headers: Headers) {
      const result = yield* Effect.tryPromise({
        try: () => auth.api.getSession({ headers }),
        catch: (cause) => new AuthError({ operation: "getSession", cause }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: SESSION_TIMEOUT,
          orElse: () => timedOut("getSession", SESSION_TIMEOUT),
        }),
      );
      return result === null
        ? Option.none()
        : Option.some({
            user: { id: result.user.id, email: result.user.email, name: result.user.name },
          });
    });

    const requestMagicLink = Effect.fn("Auth.requestMagicLink")(function* (email: string) {
      yield* Effect.tryPromise({
        try: () =>
          auth.api.signInMagicLink({
            body: {
              email,
              callbackURL: MAGIC_LINK_CALLBACK_PATH,
              errorCallbackURL: MAGIC_LINK_ERROR_PATH,
            },
            headers: new Headers({ origin: config.webOrigin }),
          }),
        catch: (cause) => new AuthError({ operation: "requestMagicLink", cause }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: HANDLE_TIMEOUT,
          orElse: () => timedOut("requestMagicLink", HANDLE_TIMEOUT),
        }),
      );
    });

    return Auth.of({ handle, getSession, requestMagicLink });
  });

  /** `Auth` with a custom magic-link sink (the CLI prints the URL). */
  static readonly layerWith = (options: AuthLayerOptions) => Layer.effect(Auth, Auth.make(options));

  /**
   * The server's `Auth`. A magic link requested through the HTTP API is never
   * delivered: the only issuer is `bun run auth:link` (ADR 0003), so the server
   * logs a notice without the address or the URL.
   */
  static readonly layer = Auth.layerWith({
    onMagicLink: () =>
      Effect.logInfo("magic link requested; links are only issued by bun run auth:link"),
  });
}
