import {
  Device,
  type DeviceId,
  DeviceNotFound,
  type DeviceRegister,
  DeviceService,
} from "@bloom/domain";
import { DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { makeDeviceRepo } from "../repos/devices.ts";
import { makeEventRepo } from "../repos/events.ts";
import { makeIngest } from "./event-sink.ts";

const asJson = Schema.decodeUnknownEffect(Schema.Json);

/**
 * Postgres-backed `DeviceService`. Registration is an upsert by push token;
 * each mutation writes an audit `Event` (`device.registered`,
 * `device.removed`) that names the device but never carries the token.
 */
export const DeviceServiceDb: Layer.Layer<DeviceService, never, SqlClient.SqlClient> = Layer.effect(
  DeviceService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const repo = yield* makeDeviceRepo;
    const ingest = makeIngest(yield* makeEventRepo);

    const audit = Effect.fnUntraced(function* (
      type: "device.registered" | "device.removed",
      device: Device,
    ) {
      const payload = yield* asJson({
        deviceId: device.id,
        platform: device.platform,
        pushEnvironment: device.pushEnvironment,
        actor: "user",
      }).pipe(Effect.orDie);
      yield* ingest({ source: "domain", type, occurredAt: yield* DateTime.now, payload });
    });

    const register = Effect.fn("DeviceService.register")(function* (input: DeviceRegister) {
      const row = yield* Device.insert.makeEffect(input).pipe(Effect.orDie);
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const device = yield* repo.upsert(row);
            yield* audit("device.registered", device);
            return device;
          }),
        )
        .pipe(Effect.orDie);
    });

    const list = repo.list().pipe(Effect.orDie, Effect.withSpan("DeviceService.list"));

    const remove = Effect.fn("DeviceService.remove")(function* (id: DeviceId) {
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const device = yield* repo.findById(id).pipe(
              Effect.catchTags({
                NoSuchElementError: () => new DeviceNotFound({ id }),
                SchemaError: Effect.die,
              }),
            );
            yield* repo.delete(device.id);
            yield* audit("device.removed", device);
          }),
        )
        .pipe(Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }));
    });

    return DeviceService.of({ register, list, remove });
  }),
);
