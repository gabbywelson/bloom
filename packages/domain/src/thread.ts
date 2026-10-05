import { Schema } from "effect";
import { Model } from "effect/schema";
import { Immutable, Nullable, ServerTimestamp, WithDefault } from "./fields.ts";
import { ThreadId } from "./ids.ts";

/** `main` is the single ongoing conversation; `side` is a tangent; `quest` is a longer project. */
export const ThreadKind = Schema.Literals(["main", "side", "quest"]);
export type ThreadKind = typeof ThreadKind.Type;

/** How much context a run in this thread assembles by default. */
export const ContextScope = Schema.Literals(["full", "minimal"]);
export type ContextScope = typeof ContextScope.Type;

/**
 * Context scope a thread gets when the creator does not choose one:
 * side threads are tangents and get a minimal scope; `main` and `quest` get full.
 * Applied by `ThreadService.create`, not by the schema, so "omitted" stays distinguishable.
 */
export const defaultContextScope = (kind: ThreadKind): ContextScope =>
  kind === "side" ? "minimal" : "full";

/** Whether the thread still accepts messages. */
export const ThreadStatus = Schema.Literals(["active", "archived"]);
export type ThreadStatus = typeof ThreadStatus.Type;

/** A conversation. Exactly one thread has kind `main`; see `ThreadService.ensureMain`. */
export class Thread extends Model.Class<Thread>("Thread")({
  id: Model.UuidV7Insert(ThreadId),
  kind: Immutable(ThreadKind),
  parentThreadId: Nullable(ThreadId),
  topic: Nullable(Schema.String),
  /** Required in the DB; optional on create so the service can apply `defaultContextScope(kind)`. */
  contextScope: Model.Field({
    select: ContextScope,
    insert: ContextScope,
    update: ContextScope,
    json: ContextScope,
    jsonCreate: Schema.optionalKey(ContextScope),
    jsonUpdate: Schema.optionalKey(ContextScope),
  }),
  status: WithDefault(ThreadStatus, "active"),
  lastMessageAt: ServerTimestamp,
  createdAt: Model.DateTimeInsertFromDate,
  updatedAt: Model.DateTimeUpdateFromDate,
}) {}

/** Client payload for creating a thread (decoded; defaults applied, `contextScope` may be omitted). */
export type ThreadCreate = typeof Thread.jsonCreate.Type;
