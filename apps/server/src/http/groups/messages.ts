import { AgentRunner, USER_FACING_MODEL_ERROR } from "@bloom/agent";
import { BloomApi } from "@bloom/api";
import { type ChatStreamEvent, ThreadService } from "@bloom/domain";
import { Effect, Stream } from "effect";
import { HttpApiBuilder } from "effect/http-api";

/**
 * Turns the runner's stream into what the SSE contract allows (no failures).
 *
 * `AgentRunner.run` emits an `error` event and then fails with `ModelError`
 * (ADR 0013); the failure is dropped so the response ends cleanly after that
 * event. A `ThreadNotFound` inside the stream can only mean the thread vanished
 * between the handler's check and the run, so it becomes a terminal `error` event.
 */
const threadVanished: ChatStreamEvent = { type: "error", message: USER_FACING_MODEL_ERROR };

export const toSseStream = <R>(
  stream: Stream.Stream<
    ChatStreamEvent,
    { readonly _tag: "ModelError" } | { readonly _tag: "ThreadNotFound" },
    R
  >,
): Stream.Stream<ChatStreamEvent, never, R> =>
  stream.pipe(
    Stream.catchTags({
      ModelError: () => Stream.empty,
      ThreadNotFound: () => Stream.succeed(threadVanished),
    }),
  );

/**
 * `POST /api/threads/:id/messages`. The runner persists the user turn itself,
 * so the handler only verifies the thread (an unknown id is a 404 before any
 * bytes are streamed) and hands the run over as SSE.
 */
export const MessagesLive = HttpApiBuilder.group(
  BloomApi,
  "messages",
  Effect.fn(function* (handlers) {
    const threads = yield* ThreadService;
    const runner = yield* AgentRunner;
    return handlers.handle(
      "send",
      Effect.fn(function* ({ params, payload }) {
        yield* threads.get(params.id);
        return toSseStream(runner.run({ threadId: params.id, text: payload.text }));
      }),
    );
  }),
);
