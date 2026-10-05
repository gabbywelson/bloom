/**
 * Applies pending migrations to DATABASE_URL and exits.
 * Run from the repo root (`bun run db:migrate`) so Bun loads `.env`.
 */
import { BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { MigratorLive, PgLive } from "../src/index.ts";

const program = Layer.build(MigratorLive.pipe(Layer.provideMerge(PgLive))).pipe(
  Effect.andThen(Effect.log("migrations applied")),
  Effect.scoped,
);

BunRuntime.runMain(program);
