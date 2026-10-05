import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { Authorization, AuthUser } from "../auth.ts";

/** `GET /api/me`: the authenticated owner. */
export class MeGroup extends HttpApiGroup.make("me")
  .add(
    HttpApiEndpoint.get("get", "/me", { success: AuthUser }).annotateMerge(
      OpenApi.annotations({
        summary: "Current user",
        description: "Returns the user the session cookie belongs to.",
      }),
    ),
  )
  .middleware(Authorization)
  .annotateMerge(
    OpenApi.annotations({
      title: "Me",
      description: "Identity of the signed-in owner.",
    }),
  ) {}
