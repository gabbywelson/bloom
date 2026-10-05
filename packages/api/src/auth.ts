import { UserId } from "@bloom/domain";
import { Context, Schema } from "effect";
import { HttpApiMiddleware } from "effect/http-api";

/** The authenticated owner as the API sees them; the wire shape of `GET /api/me`. */
export const AuthUser = Schema.Struct({
  id: UserId,
  email: Schema.String,
  name: Schema.String,
}).annotate({ identifier: "AuthUser" });
export type AuthUser = typeof AuthUser.Type;

/** Request-scoped service carrying the authenticated user; provided by `Authorization`. */
export class CurrentUser extends Context.Service<CurrentUser, AuthUser>()(
  "bloom/api/CurrentUser",
) {}

/** No valid session on the request. Encoded as HTTP 401. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

/**
 * Authorization middleware for every non-public endpoint.
 *
 * It declares no security scheme and is not `requiredForClient`: the browser
 * sends the Better Auth session cookie automatically and the server
 * implementation (in `apps/server`) reads the request headers itself. This
 * package only defines the contract; the implementation provides
 * `CurrentUser` to the wrapped handler or fails with `Unauthorized`.
 */
export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentUser }
>()("bloom/api/Authorization", { error: Unauthorized }) {}
