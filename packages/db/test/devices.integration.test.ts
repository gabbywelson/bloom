import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Device, DeviceNotFound, DeviceService, Event } from "@bloom/domain";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { ensureTestDatabase, makeTestRuntime, truncateAll } from "./helpers.ts";

const runtime = makeTestRuntime();
const decodeRegister = Schema.decodeSync(Device.jsonCreate);

const deviceEvents = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* SqlSchema.findAll({
    Request: Schema.Void,
    Result: Event,
    execute: () => sql`SELECT * FROM events WHERE type LIKE 'device.%' ORDER BY created_at, seq`,
  })();
});

beforeAll(async () => {
  await Effect.runPromise(ensureTestDatabase);
  await runtime.runPromise(Effect.void);
});
afterAll(() => runtime.dispose());
beforeEach(() => runtime.runPromise(truncateAll));

describe("DeviceServiceDb", () => {
  it("upserts by push token, lists, removes, and audits without the token", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const devices = yield* DeviceService;
        const token = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
        const first = yield* devices.register(
          decodeRegister({ platform: "ios", pushToken: token, pushEnvironment: "sandbox" }),
        );
        expect(first.pushToken).toBe(token);

        const [a, b] = yield* Effect.all(
          [
            devices.register(
              decodeRegister({
                platform: "ios",
                pushToken: token,
                pushEnvironment: "sandbox",
                name: "iPhone",
                appVersion: "0.1.0 (1)",
              }),
            ),
            devices.register(
              decodeRegister({ platform: "ios", pushToken: token, pushEnvironment: "sandbox" }),
            ),
          ],
          { concurrency: 2 },
        );
        expect(a.id).toBe(first.id);
        expect(b.id).toBe(first.id);
        expect(yield* devices.list).toHaveLength(1);

        const other = yield* devices.register(
          decodeRegister({
            platform: "ios",
            pushToken: "f".repeat(64),
            pushEnvironment: "production",
          }),
        );
        expect((yield* devices.list).map((device) => device.id)).toEqual([first.id, other.id]);

        yield* devices.remove(first.id);
        expect((yield* devices.list).map((device) => device.id)).toEqual([other.id]);
        expect(yield* Effect.flip(devices.remove(first.id))).toBeInstanceOf(DeviceNotFound);

        const events = yield* deviceEvents;
        expect(events.map((event) => event.type)).toEqual([
          "device.registered",
          "device.registered",
          "device.registered",
          "device.registered",
          "device.removed",
        ]);
        expect(JSON.stringify(events.map((event) => event.payload))).not.toContain(token);
      }),
    ));
});
