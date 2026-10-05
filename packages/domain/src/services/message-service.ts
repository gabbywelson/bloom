import { Context, Effect, Layer, Ref } from "effect";
import { MessageNotFound } from "../errors.ts";
import type { MessageId, ThreadId } from "../ids.ts";
import type { MessagePart } from "../message-part.ts";
import { Message, type MessageAppend } from "../message.ts";

/** Options for `MessageService.list`. */
export interface MessageListOptions {
  /** Return only the most recent `limit` messages (still in chronological order). */
  readonly limit?: number;
}

/**
 * Operations on messages within threads.
 *
 * Ordering contract: `list` returns messages in append order. Implementations
 * must order by `(created_at, id)` or by a sequence column, never by `id`
 * alone: UUIDv7 ids share a millisecond prefix and the remaining bits are random.
 */
export interface MessageServiceShape {
  readonly list: (
    threadId: ThreadId,
    options?: MessageListOptions,
  ) => Effect.Effect<ReadonlyArray<Message>>;
  readonly append: (input: MessageAppend) => Effect.Effect<Message>;
  /** Replaces the parts of an existing message (used while a run streams). */
  readonly replaceParts: (
    id: MessageId,
    parts: ReadonlyArray<MessagePart>,
  ) => Effect.Effect<Message, MessageNotFound>;
}

/** Message domain service with a Ref-backed `layerMemory` for tests. */
export class MessageService extends Context.Service<MessageService, MessageServiceShape>()(
  "bloom/domain/MessageService",
) {
  static readonly layerMemory = Layer.effect(
    MessageService,
    Effect.gen(function* () {
      // Map iteration order is insertion order, and re-setting an existing key
      // keeps its position, so the store itself is the append-order index.
      const store = yield* Ref.make(new Map<MessageId, Message>());

      const put = (message: Message) =>
        Ref.update(store, (messages) => new Map(messages).set(message.id, message));

      const list = Effect.fn("MessageService.list")(function* (
        threadId: ThreadId,
        options?: MessageListOptions,
      ) {
        const all = Array.from((yield* Ref.get(store)).values()).filter(
          (message) => message.threadId === threadId,
        );
        const limit = options?.limit;
        return limit === undefined ? all : all.slice(Math.max(0, all.length - limit));
      });

      const append = Effect.fn("MessageService.append")(function* (input: MessageAppend) {
        const message = new Message(
          yield* Message.insert
            .makeEffect({
              threadId: input.threadId,
              role: input.role,
              parts: input.parts,
              runId: input.runId ?? null,
            })
            .pipe(Effect.orDie),
        );
        yield* put(message);
        return message;
      });

      const replaceParts = Effect.fn("MessageService.replaceParts")(function* (
        id: MessageId,
        parts: ReadonlyArray<MessagePart>,
      ) {
        const existing = (yield* Ref.get(store)).get(id);
        if (existing === undefined) {
          return yield* new MessageNotFound({ id });
        }
        // oxlint-disable-next-line typescript/no-misused-spread -- fields are copied; the class constructor re-validates
        const next = new Message({ ...existing, parts });
        yield* put(next);
        return next;
      });

      return MessageService.of({ list, append, replaceParts });
    }),
  );
}
