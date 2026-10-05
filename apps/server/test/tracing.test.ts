/**
 * The magic-link verify request must never become an `http.server` span: the
 * tracer middleware records `url.full` / `url.query` verbatim, which would ship
 * the one-time token to the trace backend. Serves a tiny router through the
 * server's own `serveRoutes` with a recording tracer and inspects the spans.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, ManagedRuntime, Schedule, Tracer } from "effect";
import { HttpClient, HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http";
import { isTracerDisabledFor, MAGIC_LINK_VERIFY_PATH, serveRoutes } from "../src/http/server.ts";

const TOKEN = "SUPERSECRETTOKEN123";

const spans: Array<Tracer.NativeSpan> = [];
const recordingTracer = Tracer.make({
  span: (options) => {
    const span = new Tracer.NativeSpan(options);
    spans.push(span);
    return span;
  },
});

const Routes = HttpRouter.use(
  Effect.fn("TracingTestRoutes")(function* (router) {
    yield* router.add("GET", MAGIC_LINK_VERIFY_PATH, HttpServerResponse.text("verified"));
    yield* router.add("GET", "/api/health", HttpServerResponse.text("ok"));
  }),
);

const runtime = ManagedRuntime.make(
  serveRoutes(Routes).pipe(
    Layer.provideMerge(BunHttpServer.layerTest),
    Layer.provideMerge(Layer.succeed(Tracer.Tracer)(recordingTracer)),
  ),
);

afterAll(() => runtime.dispose());

const serverSpans = () => spans.filter((span) => span.kind === "server");

/** The middleware writes span attributes on a scheduled task after the response; wait for them. */
const awaitEnded = (count: number) =>
  Effect.gen(function* () {
    if (serverSpans().filter((span) => span.status._tag === "Ended").length < count) {
      return yield* Effect.fail("pending");
    }
  }).pipe(Effect.retry({ schedule: Schedule.spaced("10 millis"), times: 200 }));

const get = (path: string) =>
  runtime.runPromise(HttpClient.get(path).pipe(Effect.timeout("10 seconds")));

describe("isTracerDisabledFor", () => {
  const request = (url: string) => ({ url }) as HttpServerRequest.HttpServerRequest;

  it("matches the verify path with and without a query string", () => {
    expect(isTracerDisabledFor(request(MAGIC_LINK_VERIFY_PATH))).toBe(true);
    expect(isTracerDisabledFor(request(`${MAGIC_LINK_VERIFY_PATH}?token=${TOKEN}`))).toBe(true);
  });

  it("leaves every other request traced", () => {
    expect(isTracerDisabledFor(request("/api/health"))).toBe(false);
    expect(isTracerDisabledFor(request("/api/auth/ok"))).toBe(false);
    expect(isTracerDisabledFor(request(`${MAGIC_LINK_VERIFY_PATH}-not?token=${TOKEN}`))).toBe(
      false,
    );
  });
});

describe("server tracing", () => {
  it("records an http.server span for ordinary requests", async () => {
    const response = await get("/api/health");
    expect(response.status).toBe(200);
    await runtime.runPromise(awaitEnded(1));

    const health = serverSpans().filter(
      (span) => span.attributes.get("url.path") === "/api/health",
    );
    expect(health.length).toBe(1);
    expect(health[0]?.name).toBe("http.server GET");
    expect(health[0]?.attributes.get("http.response.status_code")).toBe(200);
  });

  it("never puts the magic-link token into a span", async () => {
    const before = serverSpans().length;
    const response = await get(`${MAGIC_LINK_VERIFY_PATH}?token=${TOKEN}&callbackURL=%2Fpasskeys`);
    expect(response.status).toBe(200);
    // Give the middleware's post-response task every chance to run before asserting.
    await runtime.runPromise(Effect.sleep("50 millis"));

    expect(serverSpans().length).toBe(before);
    const leaked = spans.filter(
      (span) =>
        span.kind === "server" &&
        [...span.attributes.values()].some(
          (value) => typeof value === "string" && value.includes(TOKEN),
        ),
    );
    expect(leaked).toEqual([]);
    expect(
      serverSpans().some((span) => span.attributes.get("url.path") === MAGIC_LINK_VERIFY_PATH),
    ).toBe(false);
  });
});
