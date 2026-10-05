/**
 * The iOS sign-in path against real Better Auth and Postgres (ADR 0018):
 * the app opens the CLI's magic link itself, reads the session token from
 * `set-auth-token`, and sends it back as `Authorization: Bearer`.
 *
 * Uses the `bloom_test` database (created and migrated on demand), never the
 * dev database, and its own owner row.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { MigratorLive, makePgLayer } from "@bloom/db";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, ManagedRuntime, Option, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { Auth } from "../src/auth/service.ts";
import { ServerConfig } from "../src/config.ts";

const TEST_DATABASE_URL =
  process.env["DATABASE_URL_TEST"] ?? "postgresql://postgres:postgres@localhost:5432/bloom_test";
const OWNER = "bearer-owner@example.com";
const WEB_ORIGIN = "http://localhost:5173";

const adminUrl = new URL(TEST_DATABASE_URL);
const databaseName = adminUrl.pathname.replace(/^\//, "");
adminUrl.pathname = "/postgres";

const ensureDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`SELECT 1 FROM pg_database WHERE datname = ${databaseName}`;
  if (rows.length === 0) {
    yield* sql.unsafe(`CREATE DATABASE "${databaseName}"`);
  }
}).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(adminUrl.toString()) })));

/** Migrates and makes sure the single owner exists (as `bun run db:seed` would). */
const seedOwner = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const existing = yield* sql<{ id: string }>`SELECT "id" FROM "user" WHERE "email" = ${OWNER}`;
  if (existing.length === 0) {
    const now = new Date();
    yield* sql`INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
               VALUES (${crypto.randomUUID()}, ${"Owner"}, ${OWNER}, true, ${now}, ${now})`;
  }
}).pipe(
  Effect.provide(
    MigratorLive.pipe(Layer.provideMerge(makePgLayer(Redacted.make(TEST_DATABASE_URL)))),
  ),
);

const TestConfig = Layer.succeed(ServerConfig)(
  ServerConfig.of({
    port: 0,
    webOrigin: WEB_ORIGIN,
    databaseUrl: Redacted.make(TEST_DATABASE_URL),
    betterAuthSecret: Redacted.make("bearer-integration-test-secret-not-for-real-use"),
    passkeyRpId: "localhost",
    passkeyRpName: "Bloom",
    ownerEmail: OWNER,
    otlpEndpoint: Option.none(),
    serviceName: "bloom-server-test",
    webDist: "apps/server/test/no-such-build-dir",
    logLevel: "Warn",
    timeZone: Option.none(),
  }),
);

const links: Array<string> = [];
const runtime = ManagedRuntime.make(
  Auth.layerWith({ onMagicLink: ({ url }) => Effect.sync(() => links.push(url)) }).pipe(
    Layer.provide(TestConfig),
  ),
);

beforeAll(async () => {
  await Effect.runPromise(ensureDatabase);
  await Effect.runPromise(seedOwner);
}, 30_000);
afterAll(() => runtime.dispose());

const issueLink = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth;
      yield* auth.requestMagicLink(OWNER);
      const link = links.at(-1);
      expect(link).toBeDefined();
      return link ?? "";
    }),
  );

/** Opens the link the way the app does: one GET, redirects not followed. */
const openLink = (link: string) =>
  runtime.runPromise(Auth.use((auth) => auth.handle(new Request(link))));

const sessionFor = (authorization: string) =>
  runtime.runPromise(Auth.use((auth) => auth.getSession(new Headers({ authorization }))));

describe("bearer tokens for native clients", () => {
  it("a magic link opened by the app yields a token that resolves the owner's session", async () => {
    const response = await openLink(await issueLink());
    expect(response.status).toBe(302);
    const token = response.headers.get("set-auth-token");
    expect(token).not.toBeNull();
    expect(token ?? "").toContain(".");

    const session = await sessionFor(`Bearer ${token ?? ""}`);
    expect(Option.isSome(session)).toBe(true);
    expect(Option.getOrUndefined(session)?.user.email).toBe(OWNER);
  });

  it("a link works once: replaying it issues no token", async () => {
    const link = await issueLink();
    expect((await openLink(link)).headers.get("set-auth-token")).not.toBeNull();
    expect((await openLink(link)).headers.get("set-auth-token")).toBeNull();
  });

  it("rejects tampered and unsigned tokens", async () => {
    const token = (await openLink(await issueLink())).headers.get("set-auth-token") ?? "";
    const [value = "", signature = ""] = decodeURIComponent(token).split(".");
    expect(Option.isNone(await sessionFor(`Bearer ${value}.${signature.slice(1)}x`))).toBe(true);
    expect(Option.isNone(await sessionFor(`Bearer ${value}`))).toBe(true);
    expect(Option.isNone(await sessionFor("Bearer not-a-token"))).toBe(true);
  });

  it("signing out with the token revokes it", async () => {
    const token = (await openLink(await issueLink())).headers.get("set-auth-token") ?? "";
    expect(Option.isSome(await sessionFor(`Bearer ${token}`))).toBe(true);
    const response = await runtime.runPromise(
      Auth.use((auth) =>
        auth.handle(
          new Request(`${WEB_ORIGIN}/api/auth/sign-out`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
          }),
        ),
      ),
    );
    expect(response.status).toBe(200);
    expect(Option.isNone(await sessionFor(`Bearer ${token}`))).toBe(true);
  });
});
