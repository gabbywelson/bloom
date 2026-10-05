import { Schema } from "effect";
import { Model } from "effect/schema";
import { Immutable, Nullable, Patchable } from "./fields.ts";
import { DeviceId } from "./ids.ts";

/** Platforms that can register for push. */
export const DevicePlatform = Schema.Literals(["ios"]).annotate({ identifier: "DevicePlatform" });
export type DevicePlatform = typeof DevicePlatform.Type;

/** APNs environment the token belongs to (debug builds get sandbox tokens). */
export const PushEnvironment = Schema.Literals(["sandbox", "production"]).annotate({
  identifier: "PushEnvironment",
});
export type PushEnvironment = typeof PushEnvironment.Type;

/**
 * A column clients write but never read back: present in the database
 * variants and in `jsonCreate`, absent from `json`.
 */
const WriteOnly = <S extends Schema.Top>(schema: S) =>
  Model.Field({ select: schema, insert: schema, update: schema, jsonCreate: schema });

/**
 * A phone (or other client) that can receive push notifications. Groundwork
 * for nudges (ADR 0023): tokens are stored, nothing sends yet. The APNs
 * token is write-only over the API. Registering the same token again updates
 * the row (`updatedAt` doubles as "last registered").
 */
export class Device extends Model.Class<Device>("Device")({
  id: Model.UuidV7Insert(DeviceId),
  platform: Immutable(DevicePlatform),
  pushToken: WriteOnly(Schema.NonEmptyString),
  pushEnvironment: Patchable(PushEnvironment),
  name: Nullable(Schema.String),
  appVersion: Nullable(Schema.String),
  createdAt: Model.DateTimeInsertFromDate,
  updatedAt: Model.DateTimeUpdateFromDate,
}) {}

/** `Device.json` under its OpenAPI component name (see `TaskJson`). */
export const DeviceJson = Device.json.annotate({ identifier: "Device" });

/** Client payload for registering a device (decoded; nullable fields default to null). */
export type DeviceRegister = typeof Device.jsonCreate.Type;
