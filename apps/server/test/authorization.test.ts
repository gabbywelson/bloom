import { describe, expect, it } from "bun:test";
import { BloomApi } from "@bloom/api";
import { UserId } from "@bloom/domain";
import { Effect, Layer, Option, Ref, Schema } from "effect";
import { HttpServer, HttpServerRequest } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { AuthorizationLive, SIGN_IN_MESSAGE, sessionHeaders } from "../src/auth/authorization.ts";
import { Auth, AuthError, type AuthShape, type SessionUser } from "../src/auth/service.ts";
import { MeLive } from "../src/http/groups/me.ts";

const owner: SessionUser = { id: "user-gabby", email: "gabby@example.com", name: "Gabby" };

type SessionResult = Effect.Effect<Option.Option<{ readonly user: SessionUser }>, AuthError>;

/** `Auth` whose `getSession` is scripted; records how many lookups happened. */
const fakeAuth = (session: SessionResult, lookups: Ref.Ref<number>) =>
  Layer.succeed(
    Auth,
    Auth.of({
      handle: () => Effect.die("handle is not used by the middleware"),
      getSession: () => Ref.update(lookups, (n) => n + 1).pipe(Effect.andThen(session)),
      requestMagicLink: () => Effect.void,
    } satisfies AuthShape),
  );

const makeClient = HttpApiTest.groups(BloomApi, ["me"]);

/** Builds the `me` group behind the real middleware over a fake `Auth`. */
const run = <A, E>(
  session: SessionResult,
  body: (client: Effect.Success<typeof makeClient>) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const lookups = yield* Ref.make(0);
      const handlers = MeLive.pipe(
        Layer.provideMerge(AuthorizationLive),
        Layer.provide(fakeAuth(session, lookups)),
      );
      const result = yield* Effect.flatMap(makeClient, body).pipe(
        Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
      );
      return { result, lookups: yield* Ref.get(lookups) };
    }).pipe(Effect.scoped),
  );

describe("Authorization middleware", () => {
  it("provides CurrentUser to the handler when a session exists", async () => {
    const { result, lookups } = await run(Effect.succeedSome({ user: owner }), (client) =>
      client.me.get(),
    );
    expect(result).toEqual({
      id: Schema.decodeSync(UserId)(owner.id),
      email: owner.email,
      name: owner.name,
    });
    expect(lookups).toBe(1);
  });

  it("fails with Unauthorized (401) when there is no session", async () => {
    const { result } = await run(Effect.succeedNone, (client) => Effect.flip(client.me.get()));
    expect(result._tag).toBe("Unauthorized");
    if (result._tag === "Unauthorized") {
      expect(result.message).toBe(SIGN_IN_MESSAGE);
    }
  });

  it("treats an Auth failure as Unauthorized rather than a 500", async () => {
    const { result } = await run(
      Effect.fail(new AuthError({ operation: "getSession", cause: new Error("db down") })),
      (client) => Effect.flip(client.me.get()),
    );
    expect(result).toMatchObject({ _tag: "Unauthorized", message: SIGN_IN_MESSAGE });
  });

  it("forwards the cookie and a bearer authorization header to Better Auth, nothing else", () => {
    const request = HttpServerRequest.fromWeb(
      new Request("http://bloom.test/api/me", {
        headers: {
          cookie: "bloom.session_token=abc",
          authorization: "Bearer tok.sig",
          "x-extra": "1",
        },
      }),
    );
    const headers = sessionHeaders(request);
    expect(headers.get("cookie")).toBe("bloom.session_token=abc");
    expect(headers.get("authorization")).toBe("Bearer tok.sig");
    expect(headers.has("x-extra")).toBe(false);

    const bare = sessionHeaders(HttpServerRequest.fromWeb(new Request("http://bloom.test/api/me")));
    expect(Array.from(bare.keys())).toEqual([]);
  });

  it("drops authorization headers that are not bearer tokens", () => {
    for (const authorization of [
      "Basic Z2FiYnk6aHVudGVyMg==",
      "Bearer",
      "Bearer   ",
      "Token abc",
    ]) {
      const headers = sessionHeaders(
        HttpServerRequest.fromWeb(
          new Request("http://bloom.test/api/me", { headers: { authorization } }),
        ),
      );
      expect(headers.has("authorization")).toBe(false);
    }
    const lower = sessionHeaders(
      HttpServerRequest.fromWeb(
        new Request("http://bloom.test/api/me", { headers: { authorization: "bearer tok.sig" } }),
      ),
    );
    expect(lower.get("authorization")).toBe("bearer tok.sig");
  });
});
