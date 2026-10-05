import {
  Message,
  type MessageAppend,
  type MessageId,
  type MessageListOptions,
  MessageNotFound,
  type MessagePart,
  MessageService,
  type ThreadId,
} from "@bloom/domain";
import { Effect, Layer } from "effect";
import type { SqlClient } from "effect/sql";
import { makeMessageRepo } from "../repos/messages.ts";

/** Postgres-backed `MessageService`. Parts are stored as jsonb; lists order by (created_at, seq). */
export const MessageServiceDb: Layer.Layer<MessageService, never, SqlClient.SqlClient> =
  Layer.effect(
    MessageService,
    Effect.gen(function* () {
      const repo = yield* makeMessageRepo;

      const list = Effect.fn("MessageService.list")(function* (
        threadId: ThreadId,
        options?: MessageListOptions,
      ) {
        const limit = options?.limit;
        return yield* repo
          .list(
            limit === undefined
              ? { threadId }
              : { threadId, limit: Math.max(0, Math.trunc(limit)) },
          )
          .pipe(Effect.orDie);
      });

      const append = Effect.fn("MessageService.append")(function* (input: MessageAppend) {
        const row = yield* Message.insert.makeEffect({
          threadId: input.threadId,
          role: input.role,
          parts: input.parts,
          runId: input.runId ?? null,
        });
        return yield* repo.insert(row);
      }, Effect.orDie);

      const replaceParts = Effect.fn("MessageService.replaceParts")(function* (
        id: MessageId,
        parts: ReadonlyArray<MessagePart>,
      ) {
        const updated = yield* repo.replaceParts({ id, parts }).pipe(Effect.orDie);
        const message = updated[0];
        if (message === undefined) {
          return yield* new MessageNotFound({ id });
        }
        return message;
      });

      return MessageService.of({ list, append, replaceParts });
    }),
  );
