import { Schema } from "effect";
import { Model } from "effect/schema";
import { Immutable, Nullable, WithDefault } from "./fields.ts";
import { CaptureId } from "./ids.ts";

/** Modality of a raw capture. */
export const CaptureKind = Schema.Literals(["text", "voice", "share", "image"]).annotate({
  identifier: "CaptureKind",
});
export type CaptureKind = typeof CaptureKind.Type;

/** Triage state of a capture. */
export const CaptureStatus = Schema.Literals(["new", "routed", "dismissed"]).annotate({
  identifier: "CaptureStatus",
});
export type CaptureStatus = typeof CaptureStatus.Type;

/**
 * Raw input before triage (quick text, voice memo, share-sheet link, photo).
 * `kind` and `payload` are write-once; triage patches `transcript`, `status`, `routedTo`.
 *
 * `payload` is free-form JSON. Clients use these shapes (ADR 0019):
 * text `{ text }`; share `{ url?, title?, text? }`; image
 * `{ dataUrl, width, height, caption? }` (a downscaled JPEG data URL until
 * blob storage exists); voice `{ dataUrl, durationSeconds }`.
 */
export class Capture extends Model.Class<Capture>("Capture")({
  id: Model.UuidV7Insert(CaptureId),
  kind: Immutable(CaptureKind),
  payload: Immutable(Schema.Json),
  transcript: Nullable(Schema.String),
  status: WithDefault(CaptureStatus, "new"),
  /** Where triage sent it, e.g. "task:<id>" or "reader". */
  routedTo: Nullable(Schema.String),
  createdAt: Model.DateTimeInsertFromDate,
  updatedAt: Model.DateTimeUpdateFromDate,
}) {}

/** Wire schemas under their OpenAPI component names (see `TaskJson`). */
export const CaptureJson = Capture.json.annotate({ identifier: "Capture" });
export const CaptureUpdateJson = Capture.jsonUpdate.annotate({ identifier: "CaptureUpdate" });

/** Client payload for creating a capture (decoded; `status` defaults to `new`). */
export type CaptureCreate = typeof Capture.jsonCreate.Type;
/** Triage patch for a capture; every key optional. */
export type CaptureUpdate = typeof Capture.jsonUpdate.Type;
