import { BunFileSystem } from "@effect/platform-bun";
import { Config, Context, Effect, FileSystem, Layer } from "effect";
import * as path from "node:path";

/** Bloom's persona document (docs/SOUL.md), loaded once at startup. */
export interface SoulShape {
  readonly text: Effect.Effect<string>;
}

/** Where SOUL.md lives in the repo, resolved from this package's location. */
export const defaultSoulPath = path.resolve(import.meta.dir, "../../../docs/SOUL.md");

/**
 * `Soul.layer` reads `BLOOM_SOUL_PATH` (default: the repo's docs/SOUL.md) once;
 * a missing file fails the layer so the server refuses to start without a persona.
 * `Soul.layerStatic(text)` is for tests.
 */
export class Soul extends Context.Service<Soul, SoulShape>()("bloom/agent/Soul") {
  static readonly layer = Layer.effect(
    Soul,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const soulPath = yield* Config.String("BLOOM_SOUL_PATH").pipe(
        Config.withDefault(defaultSoulPath),
      );
      const text = yield* fs.readFileString(soulPath);
      yield* Effect.logDebug("soul loaded").pipe(
        Effect.annotateLogs({ "bloom.soul.path": soulPath, "bloom.soul.chars": text.length }),
      );
      return Soul.of({ text: Effect.succeed(text) });
    }),
  ).pipe(Layer.provide(BunFileSystem.layer));

  static readonly layerStatic = (text: string) =>
    Layer.succeed(Soul, Soul.of({ text: Effect.succeed(text) }));
}
