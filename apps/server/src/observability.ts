/**
 * Logging and telemetry export. Logs go to the console in the pretty format
 * at `LOG_LEVEL`; when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, spans, logs and
 * metrics are exported to the collector, which fans them out to Jaeger and
 * Langfuse (ADR 0005). HTTP spans come from `HttpRouter.serve`, SQL and model
 * spans from the packages; this layer only wires the exporter.
 */
import { Effect, Layer, Logger, Option, References } from "effect";
import { FetchHttpClient } from "effect/http";
import { Otlp } from "effect/observability";
import { ServerConfig } from "./config.ts";

export const SERVICE_VERSION = "0.1.0";

export const ObservabilityLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const logging = Layer.mergeAll(
      Logger.layer([Logger.consolePretty()]),
      Layer.succeed(References.MinimumLogLevel, config.logLevel),
    );
    const otlp = Option.match(config.otlpEndpoint, {
      onNone: () => Layer.empty,
      onSome: (baseUrl) =>
        Otlp.layerJson({
          baseUrl,
          resource: {
            serviceName: config.serviceName,
            serviceVersion: SERVICE_VERSION,
            attributes: { "deployment.environment": "dev" },
          },
        }).pipe(Layer.provide(FetchHttpClient.layer)),
    });
    yield* Effect.logDebug(
      Option.isSome(config.otlpEndpoint) ? "telemetry export enabled" : "telemetry export disabled",
    );
    // The OTLP logger merges with the loggers already in place, so it must be
    // built on top of the console logger rather than beside it.
    return Layer.provideMerge(otlp, logging);
  }),
);
