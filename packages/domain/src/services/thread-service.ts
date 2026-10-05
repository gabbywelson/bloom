import { Context, type DateTime, Effect, Layer, Ref } from "effect";
import { ThreadNotFound } from "../errors.ts";
import type { ThreadId } from "../ids.ts";
import { Thread, type ThreadCreate, defaultContextScope } from "../thread.ts";

/**
 * Operations on conversation threads.
 *
 * Ordering contract: `list` returns threads in creation order. Implementations
 * must order by `(created_at, id)` or a sequence column, never by `id` alone.
 * `create` applies `defaultContextScope(kind)` when the input omits `contextScope`;
 * `lastMessageAt` is owned by `touch`.
 */
export interface ThreadServiceShape {
  readonly list: Effect.Effect<ReadonlyArray<Thread>>;
  readonly create: (input: ThreadCreate) => Effect.Effect<Thread>;
  readonly get: (id: ThreadId) => Effect.Effect<Thread, ThreadNotFound>;
  /** Returns the single `main` thread, creating it on first use. */
  readonly ensureMain: Effect.Effect<Thread>;
  /** Records that a message landed in the thread at `at`. */
  readonly touch: (id: ThreadId, at: DateTime.Utc) => Effect.Effect<void, ThreadNotFound>;
}

/** Thread domain service with a Ref-backed `layerMemory` for tests. */
export class ThreadService extends Context.Service<ThreadService, ThreadServiceShape>()(
  "bloom/domain/ThreadService",
) {
  static readonly layerMemory = Layer.effect(
    ThreadService,
    Effect.gen(function* () {
      // Map iteration order is insertion order, and re-setting an existing key
      // keeps its position, so the store itself is the creation-order index.
      const store = yield* Ref.make(new Map<ThreadId, Thread>());

      const lookup = Effect.fnUntraced(function* (id: ThreadId) {
        const thread = (yield* Ref.get(store)).get(id);
        if (thread === undefined) {
          return yield* new ThreadNotFound({ id });
        }
        return thread;
      });

      const put = (thread: Thread) =>
        Ref.update(store, (threads) => new Map(threads).set(thread.id, thread));

      const list = Ref.get(store).pipe(
        Effect.map((threads) => Array.from(threads.values())),
        Effect.withSpan("ThreadService.list"),
      );

      const create = Effect.fn("ThreadService.create")(function* (input: ThreadCreate) {
        const thread = new Thread(
          yield* Thread.insert
            .makeEffect({
              ...input,
              contextScope: input.contextScope ?? defaultContextScope(input.kind),
            })
            .pipe(Effect.orDie),
        );
        yield* put(thread);
        return thread;
      });

      const get = Effect.fn("ThreadService.get")(function* (id: ThreadId) {
        return yield* lookup(id);
      });

      const ensureMain = Effect.gen(function* () {
        const existing = Array.from((yield* Ref.get(store)).values()).find(
          (thread) => thread.kind === "main",
        );
        if (existing !== undefined) {
          return existing;
        }
        return yield* create({
          kind: "main",
          parentThreadId: null,
          topic: null,
          status: "active",
        });
      }).pipe(Effect.withSpan("ThreadService.ensureMain"));

      const touch = Effect.fn("ThreadService.touch")(function* (id: ThreadId, at: DateTime.Utc) {
        const existing = yield* lookup(id);
        // oxlint-disable-next-line typescript/no-misused-spread -- fields are copied; the class constructor re-validates
        yield* put(new Thread({ ...existing, lastMessageAt: at, updatedAt: at }));
      });

      return ThreadService.of({ list, create, get, ensureMain, touch });
    }),
  );
}
