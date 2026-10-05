import { BloomApi, CurrentUser } from "@bloom/api";
import { HttpApiBuilder } from "effect/http-api";

/** `GET /api/me`: echoes the `CurrentUser` the `Authorization` middleware resolved. */
export const MeLive = HttpApiBuilder.group(BloomApi, "me", (handlers) =>
  handlers.handle("get", () => CurrentUser),
);
