/**
 * `bun run auth:link`: prints a magic link for the owner (ADR 0003). The link
 * signs the owner in and lands on `/passkeys`; failures land on
 * `/login?error=<code>`. The URL is the only line written to stdout, so it
 * can be piped. Run from the repo root so Bun loads `.env`.
 *
 * `bun run auth:link --ios [--server <origin>]` prints the same link wrapped
 * for the iOS app instead (`bloom://sign-in?link=...`, ADR 0018); `--server`
 * sets the origin the phone uses to reach the server. In the simulator:
 * `xcrun simctl openurl booted "$(bun run auth:link --ios --server http://localhost:3000)"`.
 */
import { BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Layer, Logger, References } from "effect";
import { Auth } from "../auth/service.ts";
import { ServerConfig } from "../config.ts";
import { parseAuthLinkArgs, toNativeLink } from "./native-link.ts";

const program = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const auth = yield* Auth;
  yield* auth.requestMagicLink(config.ownerEmail);
});

const args = parseAuthLinkArgs(process.argv.slice(2));

const AuthCli = Auth.layerWith({
  onMagicLink: ({ url }) => {
    if (!args.ios) return Console.log(url);
    const native = toNativeLink(url, { server: args.server });
    return native === undefined
      ? Console.error(`--server must be an http(s) origin, got ${args.server ?? "nothing"}`)
      : Console.log(native);
  },
});

/** Only warnings and errors reach the terminal, so stdout stays the URL alone. */
const Quiet = Layer.mergeAll(
  Logger.layer([Logger.consolePretty({ mode: "tty" })]),
  Layer.succeed(References.MinimumLogLevel, "Warn"),
);

const CliLive = AuthCli.pipe(Layer.provideMerge(ServerConfig.layer), Layer.provideMerge(Quiet));

if (import.meta.main) {
  BunRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(CliLive)));
}
