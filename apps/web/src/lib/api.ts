/**
 * Promise-returning helpers over the typed `@bloom/api` client, for Svelte code.
 *
 * One `ManagedRuntime` is built from `BloomClient.layer()` with no base URL:
 * paths already start with `/api` and the browser is same-origin (ADR 0004,
 * ADR 0007), so the session cookie travels automatically. Every helper runs
 * inside that runtime; an `Unauthorized` failure sends the user to `/login`.
 */
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import { BloomClient, Unauthorized } from "@bloom/api";
import type { CaptureId, ChatStreamEvent, TaskId, ThreadId } from "@bloom/domain";
import { Effect, Exit, ManagedRuntime, Schema, Stream } from "effect";
import { session } from "./session.svelte";

const runtime = ManagedRuntime.make(BloomClient.layer());

/** Plain request/response calls get a hard limit. */
const REQUEST_TIMEOUT = "20 seconds";

/**
 * Longest silence tolerated between two chat stream events. The server fails
 * a stream silent for 60 s (ADR 0013), but that cannot reach a client whose
 * connection is wedged, so the client keeps its own, looser bound.
 */
const STREAM_IDLE_TIMEOUT = "2 minutes";

/** The chat stream produced nothing for `STREAM_IDLE_TIMEOUT`. */
class StreamStalled extends Schema.TaggedError<StreamStalled>()("StreamStalled", {}) {}

const isUnauthorized = Schema.is(Unauthorized);

/** The session is gone (expired, revoked, signed out elsewhere): resync the store and go to /login. */
const redirectToLogin = Effect.promise(async () => {
  await session.refresh();
  await goto(resolve("/login"), { replace: true });
});

const run = <A, E>(effect: Effect.Effect<A, E, BloomClient>): Promise<A> =>
  runtime.runPromise(
    Effect.tapError(effect, (error) => (isUnauthorized(error) ? redirectToLogin : Effect.void)),
  );

/** `GET /api/threads/main`: the single ongoing conversation (created on first call). */
export const loadMainThread = () =>
  run(BloomClient.use((client) => client.threads.main()).pipe(Effect.timeout(REQUEST_TIMEOUT)));

/** `GET /api/threads/:id/messages`: the thread's history, oldest first. */
export const loadMessages = (threadId: ThreadId) =>
  run(
    BloomClient.use((client) =>
      client.threads.messages({ params: { id: threadId }, query: {} }),
    ).pipe(Effect.timeout(REQUEST_TIMEOUT)),
  );

/** `GET /api/tasks`: every task, in creation order. */
export const loadTasks = () =>
  run(
    BloomClient.use((client) => client.tasks.list({ query: {} })).pipe(
      Effect.timeout(REQUEST_TIMEOUT),
    ),
  );

/** `POST /api/tasks/:id/complete`. */
export const completeTask = (id: TaskId) =>
  run(
    BloomClient.use((client) => client.tasks.complete({ params: { id } })).pipe(
      Effect.timeout(REQUEST_TIMEOUT),
    ),
  );

/** `GET /api/captures?status=new`: captures waiting for triage, in creation order. */
export const loadNewCaptures = () =>
  run(
    BloomClient.use((client) => client.captures.list({ query: { status: ["new"] } })).pipe(
      Effect.timeout(REQUEST_TIMEOUT),
    ),
  );

/** `POST /api/captures` with a `{ text }` payload (ADR 0019). */
export const captureText = (text: string) =>
  run(
    BloomClient.use((client) =>
      client.captures.create({ payload: { kind: "text", payload: { text } } }),
    ).pipe(Effect.timeout(REQUEST_TIMEOUT)),
  );

/** `PATCH /api/captures/:id` to `dismissed`. */
export const dismissCapture = (id: CaptureId) =>
  run(
    BloomClient.use((client) =>
      client.captures.update({ params: { id }, payload: { status: "dismissed" } }),
    ).pipe(Effect.timeout(REQUEST_TIMEOUT)),
  );

/**
 * `POST /api/threads/:id/messages`: sends the user's turn and feeds every
 * `ChatStreamEvent` to `onEvent` as it arrives. Resolves when the stream ends.
 *
 * After an `error` event the server fails the stream on purpose (ADR 0013);
 * that failure carries nothing the `error` event did not already say, so the
 * promise still resolves. Any other failure (network, 404, decode, a stream
 * silent for `STREAM_IDLE_TIMEOUT`) rejects.
 */
export const sendMessage = (
  threadId: ThreadId,
  text: string,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> =>
  run(
    Effect.gen(function* () {
      const client = yield* BloomClient;
      const stream = yield* client.messages.send({ params: { id: threadId }, payload: { text } });
      const bounded = Stream.timeoutOrElse(stream, {
        duration: STREAM_IDLE_TIMEOUT,
        orElse: () => Stream.fail(new StreamStalled()),
      });
      let sawError = false;
      const exit = yield* Effect.exit(
        Stream.runForEach(bounded, (event) =>
          Effect.sync(() => {
            if (event.type === "error") sawError = true;
            onEvent(event);
          }),
        ),
      );
      if (Exit.isFailure(exit) && !sawError) {
        return yield* Effect.failCause(exit.cause);
      }
    }),
  );
