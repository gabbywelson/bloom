import { Message, Thread, ThreadId } from "@bloom/domain";
import { Schema, Struct } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { Authorization } from "../auth.ts";
import { ThreadNotFound404 } from "./errors.ts";

/** Query for `GET /api/threads/:id/messages`: return only the most recent `limit` messages. */
export const MessageListQuery = {
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
};

/** Thread kinds a client may create. The single `main` thread is obtained via `GET /api/threads/main`. */
export const CreatableThreadKind = Schema.Literals(["side", "quest"]);
export type CreatableThreadKind = typeof CreatableThreadKind.Type;

/**
 * Payload for `POST /api/threads`: the encoded side of `Thread.jsonCreate`
 * (every key but `kind` optional) with `kind` narrowed to `side | quest`, so
 * no client can mint a second `main` thread. Handlers turn it into a
 * `ThreadCreate` with `decodePayload(Thread.jsonCreate)`.
 */
export const ThreadCreateInput = Schema.toEncoded(
  Thread.jsonCreate.mapFields(Struct.assign({ kind: CreatableThreadKind })),
);
export type ThreadCreateInput = typeof ThreadCreateInput.Type;

/** Conversation threads and their message history. All endpoints require `Authorization`. */
export class ThreadsGroup extends HttpApiGroup.make("threads")
  .add(
    HttpApiEndpoint.get("list", "/", { success: Schema.Array(Thread.json) }).annotateMerge(
      OpenApi.annotations({
        summary: "List threads",
        description: "All threads in creation order.",
      }),
    ),
    HttpApiEndpoint.post("create", "/", {
      payload: ThreadCreateInput,
      success: Thread.json,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Create a side thread or quest",
        description:
          "Creates a `side` or `quest` thread; the `main` thread cannot be created here (see `GET /api/threads/main`). When `contextScope` is omitted, side threads get `minimal` and quests get `full`.",
      }),
    ),
    HttpApiEndpoint.get("main", "/main", { success: Thread.json }).annotateMerge(
      OpenApi.annotations({
        summary: "Get the main thread",
        description:
          "The single ongoing conversation. Created on first call, so this is idempotent and never 404s.",
      }),
    ),
    HttpApiEndpoint.get("get", "/:id", {
      params: { id: ThreadId },
      success: Thread.json,
      error: ThreadNotFound404,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get a thread",
        description: "One thread by id.",
      }),
    ),
    HttpApiEndpoint.get("messages", "/:id/messages", {
      params: { id: ThreadId },
      query: MessageListQuery,
      success: Schema.Array(Message.json),
      error: ThreadNotFound404,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List messages in a thread",
        description:
          "Messages in chronological order. With `limit`, only the most recent `limit` messages are returned, still oldest first.",
      }),
    ),
  )
  .middleware(Authorization)
  .prefix("/threads")
  .annotateMerge(
    OpenApi.annotations({
      title: "Threads",
      description: "Conversation threads: the main thread, side threads, and quests.",
    }),
  ) {}
