import { ChatStreamEvent, ThreadId } from "@bloom/domain";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import { Authorization } from "../auth.ts";
import { ThreadNotFound404 } from "./errors.ts";

/** Body of `POST /api/threads/:id/messages`: the user's turn as plain text. */
export const SendMessage = Schema.Struct({ text: Schema.NonEmptyString }).annotate({
  identifier: "SendMessage",
});
export type SendMessage = typeof SendMessage.Type;

/**
 * Server-Sent Events stream of `ChatStreamEvent`s. Each SSE `data:` line is one
 * JSON-encoded event; the derived client exposes it as `Stream<ChatStreamEvent>`.
 */
export const ChatStream = HttpApiSchema.StreamSse({ data: ChatStreamEvent });

/** Sending a message to a thread and streaming the agent's reply. Requires `Authorization`. */
export class MessagesGroup extends HttpApiGroup.make("messages")
  .add(
    HttpApiEndpoint.post("send", "/threads/:id/messages", {
      params: { id: ThreadId },
      payload: SendMessage,
      success: ChatStream,
      error: ThreadNotFound404,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Send a message and stream the reply",
        description:
          "Appends the user message to the thread, runs the agent, and streams `ChatStreamEvent`s as Server-Sent Events until `message_end` (or `error`).",
      }),
    ),
  )
  .middleware(Authorization)
  .annotateMerge(
    OpenApi.annotations({
      title: "Messages",
      description: "Chat turns. Replies stream as text/event-stream.",
    }),
  ) {}
