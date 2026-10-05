import { BloomApi, decodePayload } from "@bloom/api";
import { MessageService, Thread, ThreadService } from "@bloom/domain";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

/**
 * `POST /api/threads` carries the encoded side of `Thread.jsonCreate` with
 * `kind` narrowed to `side | quest` (ADR 0014); decoding applies the defaults.
 */
const decodeThreadCreate = decodePayload(Thread.jsonCreate);

/** Threads group: list/create/get/main plus the message history of a thread. */
export const ThreadsLive = HttpApiBuilder.group(
  BloomApi,
  "threads",
  Effect.fn(function* (handlers) {
    const threads = yield* ThreadService;
    const messages = yield* MessageService;
    return handlers.handleAll({
      list: () => threads.list,
      create: ({ payload }) => Effect.flatMap(decodeThreadCreate(payload), threads.create),
      main: () => threads.ensureMain,
      get: ({ params }) => threads.get(params.id),
      messages: ({ params, query }) =>
        threads
          .get(params.id)
          .pipe(
            Effect.flatMap(() =>
              messages.list(params.id, query.limit === undefined ? {} : { limit: query.limit }),
            ),
          ),
    });
  }),
);
