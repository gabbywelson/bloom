/**
 * Idempotent seed: the single Better Auth user (from BLOOM_OWNER_EMAIL /
 * BLOOM_OWNER_NAME) and the main thread. Safe to re-run. Prints what it did,
 * never secrets. Run from the repo root (`bun run db:seed`) so Bun loads `.env`.
 */
import { ThreadService } from "@bloom/domain";
import { BunRuntime } from "@effect/platform-bun";
import { Config, Effect } from "effect";
import { SqlClient } from "effect/sql";
import { DbLive } from "../src/index.ts";

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Better Auth looks users up by lowercased email (findUserByEmail), so the
  // seeded row must match that form or the magic-link flow never finds it.
  const email = (yield* Config.NonEmptyString("BLOOM_OWNER_EMAIL")).toLowerCase();
  const name = yield* Config.NonEmptyString("BLOOM_OWNER_NAME");

  // Better Auth owns the "user" table and its camelCase identifiers; raw text
  // in the template is not run through the snake_case transform.
  const existing = yield* sql<{ id: string }>`SELECT "id" FROM "user" WHERE "email" = ${email}`;
  if (existing.length === 0) {
    const now = new Date();
    yield* sql`INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
               VALUES (${crypto.randomUUID()}, ${name}, ${email}, true, ${now}, ${now})`;
    yield* Effect.log("seed: created owner user");
  } else {
    yield* Effect.log("seed: owner user already present");
  }

  const threads = yield* ThreadService;
  const main = yield* threads.ensureMain;
  yield* Effect.log(`seed: main thread ${main.id} (created ${main.createdAt.toString()})`);
});

BunRuntime.runMain(seed.pipe(Effect.provide(DbLive)));
