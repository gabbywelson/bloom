import {
  Thread,
  type ThreadCreate,
  type ThreadId,
  ThreadNotFound,
  ThreadService,
  defaultContextScope,
} from "@bloom/domain";
import { type DateTime, Effect, Layer, Option } from "effect";
import type { SqlClient } from "effect/sql";
import { makeThreadRepo } from "../repos/threads.ts";

/** Postgres-backed `ThreadService`. `ensureMain` is race-safe via the partial unique index on kind = 'main'. */
export const ThreadServiceDb: Layer.Layer<ThreadService, never, SqlClient.SqlClient> = Layer.effect(
  ThreadService,
  Effect.gen(function* () {
    const repo = yield* makeThreadRepo;

    const list = repo.list().pipe(Effect.orDie, Effect.withSpan("ThreadService.list"));

    const create = Effect.fn("ThreadService.create")(function* (input: ThreadCreate) {
      const row = yield* Thread.insert.makeEffect({
        ...input,
        contextScope: input.contextScope ?? defaultContextScope(input.kind),
      });
      return yield* repo.insert(row);
    }, Effect.orDie);

    const get = Effect.fn("ThreadService.get")(function* (id: ThreadId) {
      return yield* repo.findById(id).pipe(
        Effect.catchTags({
          NoSuchElementError: () => new ThreadNotFound({ id }),
          SchemaError: Effect.die,
          SqlError: Effect.die,
        }),
      );
    });

    const ensureMain = Effect.gen(function* () {
      const existing = yield* repo.findMain().pipe(Effect.orDie);
      if (Option.isSome(existing)) {
        return existing.value;
      }
      const row = yield* Thread.insert
        .makeEffect({
          kind: "main",
          parentThreadId: null,
          topic: null,
          contextScope: defaultContextScope("main"),
          status: "active",
        })
        .pipe(Effect.orDie);
      const inserted = yield* repo.insertMainIfAbsent(row).pipe(Effect.orDie);
      const winner = inserted[0];
      if (winner !== undefined) {
        return winner;
      }
      // Lost the race: another fiber inserted main between our read and write.
      const again = yield* repo.findMain().pipe(Effect.orDie);
      if (Option.isNone(again)) {
        return yield* Effect.die(new Error("main thread vanished after a conflicting insert"));
      }
      return again.value;
    }).pipe(Effect.withSpan("ThreadService.ensureMain"));

    const touch = Effect.fn("ThreadService.touch")(function* (id: ThreadId, at: DateTime.Utc) {
      const updated = yield* repo.touch({ id, at }).pipe(Effect.orDie);
      if (updated.length === 0) {
        return yield* new ThreadNotFound({ id });
      }
    });

    return ThreadService.of({ list, create, get, ensureMain, touch });
  }),
);
