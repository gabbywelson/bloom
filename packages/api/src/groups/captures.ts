import { Capture, CaptureId, CaptureJson, CaptureStatus, CaptureUpdateJson } from "@bloom/domain";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { Authorization } from "../auth.ts";
import { CaptureNotFound404 } from "./errors.ts";

/** Query for `GET /api/captures`: optional status filter (`?status=new`). */
export const CaptureListQuery = {
  status: Schema.optional(Schema.Array(CaptureStatus)),
};

/**
 * Payload for `POST /api/captures`: the encoded side of `Capture.jsonCreate`
 * (ADR 0014), so only `kind` and `payload` are required. Handlers decode it
 * with `decodePayload(Capture.jsonCreate)`, which defaults `status` to `new`.
 */
export const CaptureCreateInput = Schema.toEncoded(Capture.jsonCreate).annotate({
  identifier: "CaptureCreate",
});
export type CaptureCreateInput = typeof CaptureCreateInput.Type;

/** Raw captures from the phone, the share sheet and the web. Requires `Authorization`. */
export class CapturesGroup extends HttpApiGroup.make("captures")
  .add(
    HttpApiEndpoint.post("create", "/", {
      payload: CaptureCreateInput,
      success: CaptureJson,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "File a capture",
        description:
          "Stores raw input for triage. `payload` is free-form JSON; by convention text is `{ text }`, a shared link `{ url, title?, text? }`, an image `{ dataUrl, width, height, caption? }` (ADR 0019).",
      }),
    ),
    HttpApiEndpoint.get("list", "/", {
      query: CaptureListQuery,
      success: Schema.Array(CaptureJson),
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List captures",
        description: "Captures in creation order, optionally filtered by status (`?status=new`).",
      }),
    ),
    HttpApiEndpoint.get("get", "/:id", {
      params: { id: CaptureId },
      success: CaptureJson,
      error: CaptureNotFound404,
    }).annotateMerge(
      OpenApi.annotations({ summary: "Get a capture", description: "One capture by id." }),
    ),
    HttpApiEndpoint.patch("update", "/:id", {
      params: { id: CaptureId },
      payload: CaptureUpdateJson,
      success: CaptureJson,
      error: CaptureNotFound404,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Triage a capture",
        description:
          "Partial update of `status`, `routedTo` and `transcript`; `kind` and `payload` never change.",
      }),
    ),
  )
  .middleware(Authorization)
  .prefix("/captures")
  .annotateMerge(
    OpenApi.annotations({
      title: "Captures",
      description: "Raw input (text, voice, share, image) waiting for triage.",
    }),
  ) {}
