import { describe, expect, it } from "bun:test";
import { Authorization, BloomApi, CurrentUser } from "@bloom/api";
import { CaptureService, UserId } from "@bloom/domain";
import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { CapturesLive } from "../src/http/groups/captures.ts";

const AuthorizationAllow = Layer.succeed(Authorization)((httpEffect) =>
  Effect.provideService(httpEffect, CurrentUser, {
    id: Schema.decodeSync(UserId)("user-gabby"),
    email: "gabby@example.com",
    name: "Gabby",
  }),
);

const makeClient = HttpApiTest.groups(BloomApi, ["captures"]);

const run = <A, E>(body: (client: Effect.Success<typeof makeClient>) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.flatMap(makeClient, body).pipe(
      Effect.provide(
        Layer.mergeAll(
          CapturesLive.pipe(
            Layer.provideMerge(AuthorizationAllow),
            Layer.provide(CaptureService.layerMemory),
          ),
          HttpServer.layerServices,
        ),
      ),
      Effect.scoped,
    ),
  );

describe("captures handlers", () => {
  it("files a shared link, lists new captures and dismisses one", async () => {
    const result = await run((client) =>
      Effect.gen(function* () {
        const link = yield* client.captures.create({
          payload: {
            kind: "share",
            payload: { url: "https://example.com/read-later", title: "Read later" },
          },
        });
        const image = yield* client.captures.create({
          payload: {
            kind: "image",
            payload: { dataUrl: "data:image/jpeg;base64,AAAA", width: 1, height: 1 },
          },
        });
        yield* client.captures.update({
          params: { id: image.id },
          payload: { status: "dismissed" },
        });
        const fresh = yield* client.captures.list({ query: { status: ["new"] } });
        const all = yield* client.captures.list({ query: {} });
        return { link, fresh, all };
      }),
    );
    expect(result.link.kind).toBe("share");
    expect(result.link.status).toBe("new");
    expect(result.fresh.map((capture) => capture.id)).toEqual([result.link.id]);
    expect(result.all).toHaveLength(2);
  });
});
