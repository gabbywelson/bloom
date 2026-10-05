import { Effect, Schema } from "effect";
import { Model } from "effect/schema";

/**
 * Postgres facts these helpers encode: `@effect/sql-pg` decodes `timestamptz`
 * to a JS `Date` and `jsonb` to parsed JSON. DB variants (select/insert/update)
 * therefore use `*FromDate` schemas, while JSON variants use ISO strings.
 */

const TimestampDb = Schema.DateTimeUtcFromDate;
const TimestampJson = Schema.DateTimeUtcFromString;
const NullableTimestampDb = Schema.NullOr(TimestampDb);
const NullableTimestampJson = Schema.NullOr(TimestampJson);

/** Required, caller-supplied timestamp: `Date` in DB variants, ISO string in JSON variants. */
export const Timestamp = Model.Field({
  select: TimestampDb,
  insert: TimestampDb,
  update: TimestampDb,
  json: TimestampJson,
  jsonCreate: TimestampJson,
  jsonUpdate: Schema.optionalKey(TimestampJson),
});

/** Required, caller-supplied, write-once timestamp (e.g. `Event.occurredAt`): absent from update variants. */
export const ImmutableTimestamp = Model.Field({
  select: TimestampDb,
  insert: TimestampDb,
  json: TimestampJson,
  jsonCreate: TimestampJson,
});

/**
 * Nullable, caller-supplied timestamp (due, scheduledFor, ...).
 * Defaults to `null` on insert/jsonCreate when omitted; optional in jsonUpdate.
 */
export const NullableTimestamp = Model.Field({
  select: NullableTimestampDb,
  insert: NullableTimestampDb.pipe(Schema.withConstructorDefault(Effect.succeed(null))),
  update: NullableTimestampDb,
  json: NullableTimestampJson,
  jsonCreate: NullableTimestampJson.pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  jsonUpdate: Schema.optionalKey(NullableTimestampJson),
});

/**
 * Nullable timestamp owned by a domain service (completedAt, lastMessageAt,
 * sentAt, outcomeAt): readable over JSON but absent from jsonCreate/jsonUpdate,
 * so clients cannot set it. Defaults to `null` in the insert constructor.
 */
export const ServerTimestamp = Model.Field({
  select: NullableTimestampDb,
  insert: NullableTimestampDb.pipe(Schema.withConstructorDefault(Effect.succeed(null))),
  update: NullableTimestampDb,
  json: NullableTimestampJson,
});

/**
 * Nullable column. Defaults to `null` on insert/jsonCreate when omitted;
 * optional in jsonUpdate so clients can send partial patches.
 */
export const Nullable = <S extends Schema.Top>(schema: S) => {
  const nullable = Schema.NullOr(schema);
  return Model.Field({
    select: nullable,
    insert: nullable.pipe(Schema.withConstructorDefault(Effect.succeed(null))),
    update: nullable,
    json: nullable,
    jsonCreate: nullable.pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
    jsonUpdate: Schema.optionalKey(nullable),
  });
};

/**
 * Required column with a default: filled in by the insert constructor and by
 * jsonCreate decoding when the client omits it; optional in jsonUpdate.
 */
export const WithDefault = <S extends Schema.Top & Schema.WithoutConstructorDefault>(
  schema: S,
  value: S["Encoded"] & S["~type.make.in"],
) =>
  Model.Field({
    select: schema,
    insert: schema.pipe(Schema.withConstructorDefault(Effect.succeed(value))),
    update: schema,
    json: schema,
    jsonCreate: schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value))),
    jsonUpdate: Schema.optionalKey(schema),
  });

/** Required column that is required on create but optional in jsonUpdate patches. */
export const Patchable = <S extends Schema.Top>(schema: S) =>
  Model.Field({
    select: schema,
    insert: schema,
    update: schema,
    json: schema,
    jsonCreate: schema,
    jsonUpdate: Schema.optionalKey(schema),
  });

/** Required, immutable column: present on select/insert/json/jsonCreate, absent from update variants. */
export const Immutable = <S extends Schema.Top>(schema: S) =>
  Model.Field({
    select: schema,
    insert: schema,
    json: schema,
    jsonCreate: schema,
  });
