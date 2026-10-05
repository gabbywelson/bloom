/**
 * Writes `packages/api/openapi.json` from the `BloomApi` definition.
 *
 * Run from the repo root with `bun run openapi`. An optional first argument
 * overrides the output path (used by the tests).
 */
import { Effect, Schema } from "effect";
import { renderOpenApiJson } from "../src/openapi.ts";

class OpenApiWriteError extends Schema.TaggedError<OpenApiWriteError>()("OpenApiWriteError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

const defaultOutput = new URL("../openapi.json", import.meta.url);
const outputArg = process.argv[2];
const output: string | URL = outputArg === undefined ? defaultOutput : outputArg;
const outputPath = typeof output === "string" ? output : output.pathname;

const program = Effect.gen(function* () {
  const json = renderOpenApiJson();
  yield* Effect.tryPromise({
    try: () => Bun.write(output, json),
    catch: (cause) => new OpenApiWriteError({ path: outputPath, cause }),
  });
  yield* Effect.log(`wrote ${outputPath}`);
}).pipe(Effect.withSpan("emit-openapi"));

await Effect.runPromise(program);
