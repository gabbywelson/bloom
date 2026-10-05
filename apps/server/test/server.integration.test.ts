/**
 * Boots the real `ServerLive` (Postgres from `DATABASE_URL`, pg-boss, Better
 * Auth, agent runtime) on a random port and checks the public surface. Run
 * from the repo root (`bun test apps/server`) so Bun loads `.env`.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Effect, ManagedRuntime } from "effect";
import { HttpServer } from "effect/http";

process.env["PORT"] = "0";
process.env["ANTHROPIC_API_KEY"] ??= "sk-test-placeholder";
process.env["LOG_LEVEL"] ??= "Warn";
process.env["BLOOM_WEB_DIST"] = "apps/server/test/no-such-build-dir";
delete process.env["BLOOM_JOBS_RUN_ON_START"];

const { ServerLive } = await import("../src/main.ts");

const runtime = ManagedRuntime.make(ServerLive);
let baseUrl = "";

beforeAll(async () => {
  const server = await runtime.runPromise(HttpServer.HttpServer);
  const address = server.address;
  if (address._tag === "UnixPathAddress") {
    throw new Error("expected a TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(() => runtime.dispose());

const get = (path: string, init?: RequestInit) =>
  Effect.runPromise(
    Effect.tryPromise(() => fetch(`${baseUrl}${path}`, init)).pipe(Effect.timeout("10 seconds")),
  );

describe("bloom-server", () => {
  it("GET /api/health answers 200 JSON", async () => {
    const response = await get("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { status: string; service: string; time: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("bloom-server");
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it("GET /api/tasks without a cookie answers 401 Unauthorized", async () => {
    const response = await get("/api/tasks");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ _tag: "Unauthorized", message: "Please sign in." });
  });

  it("GET /api/auth/ok reaches Better Auth", async () => {
    const response = await get("/api/auth/ok");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("GET /api/openapi.json serves the OpenAPI document", async () => {
    const response = await get("/api/openapi.json");
    expect(response.status).toBe(200);
    const spec = (await response.json()) as { info?: { title?: string }; paths?: object };
    expect(spec.info?.title).toBe("Bloom API");
    expect(Object.keys(spec.paths ?? {})).toContain("/api/health");
  });

  it("GET /api/docs serves the Scalar page", async () => {
    const response = await get("/api/docs");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("unknown paths are 404 when no web build is present", async () => {
    expect((await get("/api/nope")).status).toBe(404);
    expect((await get("/passkeys", { headers: { accept: "text/html" } })).status).toBe(404);
  });
});
