import { Schema } from "effect";
import { Model } from "effect/schema";
import { Immutable, Nullable, WithDefault } from "./fields.ts";
import { CaptureId } from "./ids.ts";

/** Modality of a raw capture. */
export const CaptureKind = Schema.Literals(["text", "voice", "share", "image"]);
export type CaptureKind = typeof CaptureKind.Type;

/** Triage state of a capture. */
export const CaptureStatus = Schema.Literals(["new", "routed", "dismissed"]);
export type CaptureStatus = typeof CaptureStatus.Type;

/**
 * Raw input before triage (quick text, voice memo, share-sheet link, photo).
 * `kind` and `payload` are write-once; triage patches `transcript`, `status`, `routedTo`.
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
