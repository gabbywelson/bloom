import { Device, DeviceId, DeviceJson } from "@bloom/domain";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { Authorization } from "../auth.ts";
import { DeviceNotFound404 } from "./errors.ts";

/**
 * Payload for `POST /api/devices`: the encoded side of `Device.jsonCreate`
 * (ADR 0014): `platform`, `pushToken` and `pushEnvironment` required.
 */
export const DeviceRegisterInput = Schema.toEncoded(Device.jsonCreate).annotate({
  identifier: "DeviceRegister",
});
export type DeviceRegisterInput = typeof DeviceRegisterInput.Type;

/** Push registration groundwork (ADR 0023). Tokens are write-only. */
export class DevicesGroup extends HttpApiGroup.make("devices")
  .add(
    HttpApiEndpoint.post("register", "/", {
      payload: DeviceRegisterInput,
      success: DeviceJson,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Register a device for push",
        description:
          "Stores the device's APNs token. Registering the same token again updates name, version and environment instead of adding a row. The token is never returned.",
      }),
    ),
    HttpApiEndpoint.get("list", "/", { success: Schema.Array(DeviceJson) }).annotateMerge(
      OpenApi.annotations({
        summary: "List devices",
        description: "Registered devices, oldest first.",
      }),
    ),
    HttpApiEndpoint.delete("remove", "/:id", {
      params: { id: DeviceId },
      error: DeviceNotFound404,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Forget a device",
        description: "Removes the registration. Responds 204 with no body.",
      }),
    ),
  )
  .middleware(Authorization)
  .prefix("/devices")
  .annotateMerge(
    OpenApi.annotations({
      title: "Devices",
      description: "Phones registered for push notifications.",
    }),
  ) {}
