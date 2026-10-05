import { Effect, Schema } from "effect";
import { HttpApiError } from "effect/http-api";

/**
 * Decodes an endpoint payload declared with `Schema.toEncoded(X)` into `X`'s
 * decoded type (defaults applied, timestamps parsed).
 *
 * Create endpoints declare their payload as the encoded side of the domain
 * `jsonCreate` variant so the derived TypeScript client can send a minimal
 * body (`{ title }`) instead of every key. The handler then calls
 * `decodePayload(Task.jsonCreate)(payload)` before handing the result to the
 * domain service.
 *
 * The encoded side already enforces the shape, so a decode failure can only
 * come from a value-level check the encoded side cannot express (an ISO
 * timestamp that does not parse, for example). Such a failure becomes
 * `HttpApiError.HttpApiSchemaError` with kind `Payload`, which is exactly what
 * `HttpApiBuilder` raises for its own payload decoding: it renders as an
 * empty `400 Bad Request`.
 */
export const decodePayload = <Source extends Schema.Top>(schema: Source) => {
  const decode = Schema.decodeUnknownEffect(schema);
  return (
    input: Source["Encoded"],
  ): Effect.Effect<Source["Type"], never, Source["DecodingServices"]> =>
    decode(input).pipe(
      Effect.catch((cause) =>
        Effect.die(new HttpApiError.HttpApiSchemaError({ kind: "Payload", cause })),
      ),
    );
};
