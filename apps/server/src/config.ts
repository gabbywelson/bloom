/**
 * Server configuration, read once from the environment with Effect `Config`.
 *
 * Bun loads `.env` from the current working directory, so every entry point
 * (`bun run dev:server`, `bun run auth:link`, `bun test apps/server`) must be
 * launched from the repo root. Secrets are `Redacted` so they never print.
 */
import {
  Config,
  Context,
  Effect,
  Layer,
  type LogLevel,
  Option,
  type Redacted,
  Schema,
} from "effect";

export interface ServerConfigShape {
  /** TCP port the HTTP server binds (`PORT`, default 3000; 0 lets the OS pick, for tests). */
  readonly port: number;
  /** Browser origin of the web app (`BLOOM_WEB_ORIGIN`); cookies and passkeys bind to it (ADR 0004). */
  readonly webOrigin: string;
  /** `DATABASE_URL`, shared by `@bloom/db`, Better Auth and pg-boss. */
  readonly databaseUrl: Redacted.Redacted;
  /** `BETTER_AUTH_SECRET`: signs cookies and hashes tokens. */
  readonly betterAuthSecret: Redacted.Redacted;
  /** WebAuthn relying party (`BLOOM_PASSKEY_RP_ID`, `BLOOM_PASSKEY_RP_NAME`). */
  readonly passkeyRpId: string;
  readonly passkeyRpName: string;
  /** The single owner's email (`BLOOM_OWNER_EMAIL`); the CLI issues magic links for it. */
  readonly ownerEmail: string;
  /** OTLP/HTTP base URL of the collector (`OTEL_EXPORTER_OTLP_ENDPOINT`); none disables export. */
  readonly otlpEndpoint: Option.Option<string>;
  /** `OTEL_SERVICE_NAME`, default `bloom-server`. */
  readonly serviceName: string;
  /** Directory of the static SvelteKit build served in production (`BLOOM_WEB_DIST`). */
  readonly webDist: string;
  /** Minimum log level (`LOG_LEVEL`, default `Info`). */
  readonly logLevel: LogLevel.LogLevel;
  /** Owner's IANA time zone (`BLOOM_TIME_ZONE`), consumed by the interruption policy. */
  readonly timeZone: Option.Option<string>;
}

/** The raw `Config` description; `ServerConfig.layer` is the usual way to consume it. */
export const serverConfig: Config.Config<ServerConfigShape> = Config.all({
  port: Config.schema(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 })),
    "PORT",
  ).pipe(Config.withDefault(3000)),
  webOrigin: Config.NonEmptyString("BLOOM_WEB_ORIGIN"),
  databaseUrl: Config.Redacted("DATABASE_URL"),
  betterAuthSecret: Config.Redacted("BETTER_AUTH_SECRET"),
  passkeyRpId: Config.NonEmptyString("BLOOM_PASSKEY_RP_ID").pipe(Config.withDefault("localhost")),
  passkeyRpName: Config.NonEmptyString("BLOOM_PASSKEY_RP_NAME").pipe(Config.withDefault("Bloom")),
  ownerEmail: Config.NonEmptyString("BLOOM_OWNER_EMAIL").pipe(
    Config.map((email) => email.toLowerCase()),
  ),
  otlpEndpoint: Config.option(Config.NonEmptyString("OTEL_EXPORTER_OTLP_ENDPOINT")),
  serviceName: Config.NonEmptyString("OTEL_SERVICE_NAME").pipe(Config.withDefault("bloom-server")),
  webDist: Config.NonEmptyString("BLOOM_WEB_DIST").pipe(Config.withDefault("apps/web/build")),
  logLevel: Config.LogLevel("LOG_LEVEL").pipe(Config.withDefault<LogLevel.LogLevel>("Info")),
  timeZone: Config.option(Config.NonEmptyString("BLOOM_TIME_ZONE")),
});

/** Resolved configuration as a service, built once at startup. Fails the layer if a required variable is missing. */
export class ServerConfig extends Context.Service<ServerConfig, ServerConfigShape>()(
  "bloom/server/ServerConfig",
) {
  static readonly layer = Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const config = yield* serverConfig;
      yield* Effect.logDebug("server config loaded").pipe(
        Effect.annotateLogs({
          "bloom.port": config.port,
          "bloom.web_origin": config.webOrigin,
          "bloom.otlp": Option.isSome(config.otlpEndpoint),
          "bloom.log_level": config.logLevel,
        }),
      );
      return ServerConfig.of(config);
    }),
  );
}
