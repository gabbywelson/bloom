import { BloomApi, decodePayload } from "@bloom/api";
import { Capture, CaptureService } from "@bloom/domain";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

/** `POST /api/captures` carries the encoded side of `Capture.jsonCreate` (ADR 0014). */
const decodeCaptureCreate = decodePayload(Capture.jsonCreate);

/**
 * Captures from the user's devices. Every mutation goes through
 * `CaptureService` as the `user` actor, so the audit `Event` is written.
 */
export const CapturesLive = HttpApiBuilder.group(
  BloomApi,
  "captures",
  Effect.fn(function* (handlers) {
    const captures = yield* CaptureService;
    return handlers.handleAll({
      create: ({ payload }) =>
        Effect.flatMap(decodeCaptureCreate(payload), (input) => captures.create(input, "user")),
      list: ({ query }) =>
        captures.list(query.status === undefined ? undefined : { status: query.status }),
      get: ({ params }) => captures.get(params.id),
      update: ({ params, payload }) => captures.update(params.id, payload, "user"),
    });
  }),
);
