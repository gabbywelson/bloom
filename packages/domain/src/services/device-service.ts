import { Context, DateTime, Effect, Layer, Ref } from "effect";
import { Device, type DeviceRegister } from "../device.ts";
import { DeviceNotFound } from "../errors.ts";
import type { DeviceId } from "../ids.ts";

/**
 * Devices registered for push. `register` is an upsert keyed by the push
 * token, so a phone re-registering on every launch keeps one row.
 * Ordering contract: `list` returns devices in creation order.
 */
export interface DeviceServiceShape {
  readonly register: (input: DeviceRegister) => Effect.Effect<Device>;
  readonly list: Effect.Effect<ReadonlyArray<Device>>;
  readonly remove: (id: DeviceId) => Effect.Effect<void, DeviceNotFound>;
}

/** Device service with a Ref-backed `layerMemory`; the DB layer lives in `@bloom/db`. */
export class DeviceService extends Context.Service<DeviceService, DeviceServiceShape>()(
  "bloom/domain/DeviceService",
) {
  static readonly layerMemory = Layer.effect(
    DeviceService,
    Effect.gen(function* () {
      // Insertion-ordered map; re-registering keeps the device's position.
      const store = yield* Ref.make(new Map<DeviceId, Device>());

      const register = Effect.fn("DeviceService.register")(function* (input: DeviceRegister) {
        const existing = Array.from((yield* Ref.get(store)).values()).find(
          (device) => device.pushToken === input.pushToken,
        );
        const now = yield* DateTime.now;
        const device =
          existing === undefined
            ? new Device(yield* Device.insert.makeEffect(input).pipe(Effect.orDie))
            : new Device({
                // oxlint-disable-next-line typescript/no-misused-spread -- fields are copied; the class constructor re-validates
                ...existing,
                pushEnvironment: input.pushEnvironment,
                name: input.name,
                appVersion: input.appVersion,
                updatedAt: now,
              });
        yield* Ref.update(store, (devices) => new Map(devices).set(device.id, device));
        return device;
      });

      const list = Ref.get(store).pipe(
        Effect.map((devices) => Array.from(devices.values())),
        Effect.withSpan("DeviceService.list"),
      );

      const remove = Effect.fn("DeviceService.remove")(function* (id: DeviceId) {
        const devices = yield* Ref.get(store);
        if (!devices.has(id)) {
          return yield* new DeviceNotFound({ id });
        }
        const next = new Map(devices);
        next.delete(id);
        yield* Ref.set(store, next);
      });

      return DeviceService.of({ register, list, remove });
    }),
  );
}
