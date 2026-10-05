import { Schema } from "effect";

/** Branded id of the single Bloom user (kept for future multi-device auth). */
export const UserId = Schema.String.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

/** Branded id of a `Task`. */
export const TaskId = Schema.String.pipe(Schema.brand("TaskId"));
export type TaskId = typeof TaskId.Type;

/** Branded id of a `Thread`. */
export const ThreadId = Schema.String.pipe(Schema.brand("ThreadId"));
export type ThreadId = typeof ThreadId.Type;

/** Branded id of a `Message`. */
export const MessageId = Schema.String.pipe(Schema.brand("MessageId"));
export type MessageId = typeof MessageId.Type;

/** Branded id of an `Event`. */
export const EventId = Schema.String.pipe(Schema.brand("EventId"));
export type EventId = typeof EventId.Type;

/** Branded id of a `Nudge`. */
export const NudgeId = Schema.String.pipe(Schema.brand("NudgeId"));
export type NudgeId = typeof NudgeId.Type;

/** Branded id of a `Capture`. */
export const CaptureId = Schema.String.pipe(Schema.brand("CaptureId"));
export type CaptureId = typeof CaptureId.Type;

/** Branded id of an agent run (one model invocation loop). */
export const RunId = Schema.String.pipe(Schema.brand("RunId"));
export type RunId = typeof RunId.Type;

/** Branded id of a registered `Device`. */
export const DeviceId = Schema.String.pipe(Schema.brand("DeviceId"));
export type DeviceId = typeof DeviceId.Type;
