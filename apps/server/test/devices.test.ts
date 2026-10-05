import { describe, expect, it } from "bun:test";
import { Authorization, BloomApi, CurrentUser } from "@bloom/api";
import { DeviceService, UserId } from "@bloom/domain";
import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { DevicesLive } from "../src/http/groups/devices.ts";

const AuthorizationAllow = Layer.succeed(Authorization)((httpEffect) =>
  Effect.provideService(httpEffect, CurrentUser, {
    id: Schema.decodeSync(UserId)("user-gabby"),
    email: "gabby@example.com",
    name: "Gabby",
  }),
);

const makeClient = HttpApiTest.groups(BloomApi, ["devices"]);

const run = <A, E>(body: (client: Effect.Success<typeof makeClient>) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.flatMap(makeClient, body).pipe(
      Effect.provide(
        Layer.mergeAll(
          DevicesLive.pipe(
            Layer.provideMerge(AuthorizationAllow),
            Layer.provide(DeviceService.layerMemory),
          ),
          HttpServer.layerServices,
        ),
      ),
      Effect.scoped,
    ),
  );

describe("devices handlers", () => {
  it("registers a phone, keeps one row per token and hides the token", async () => {
    const { first, second, all } = await run((client) =>
      Effect.gen(function* () {
        const payload = {
          platform: "ios",
          pushToken: "0f".repeat(32),
          pushEnvironment: "sandbox",
          name: "iPhone",
        } as const;
        const first = yield* client.devices.register({ payload });
        const second = yield* client.devices.register({
          payload: { ...payload, appVersion: "0.1.0 (1)" },
        });
        return { first, second, all: yield* client.devices.list() };
      }),
    );
    expect(second.id).toBe(first.id);
    expect(second.appVersion).toBe("0.1.0 (1)");
    expect(all).toHaveLength(1);
    expect(JSON.stringify(all)).not.toContain("0f0f0f");
  });
});
