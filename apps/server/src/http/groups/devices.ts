import { BloomApi, decodePayload } from "@bloom/api";
import { Device, DeviceService } from "@bloom/domain";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

const decodeRegister = decodePayload(Device.jsonCreate);

/**
 * Push registration groundwork (ADR 0023): devices are stored through
 * `DeviceService`; nothing sends notifications yet. The token is never logged.
 */
export const DevicesLive = HttpApiBuilder.group(
  BloomApi,
  "devices",
  Effect.fn(function* (handlers) {
    const devices = yield* DeviceService;
    return handlers.handleAll({
      register: ({ payload }) => Effect.flatMap(decodeRegister(payload), devices.register),
      list: () => devices.list,
      remove: ({ params }) => devices.remove(params.id),
    });
  }),
);
