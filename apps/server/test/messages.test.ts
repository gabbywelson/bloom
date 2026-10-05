import { describe, expect, it } from "bun:test";
import { AgentRunner, ModelError, USER_FACING_MODEL_ERROR } from "@bloom/agent";
import { Authorization, BloomApi, CurrentUser } from "@bloom/api";
import {
  type ChatStreamEvent,
  MessageService,
  ThreadId,
  ThreadNotFound,
  ThreadService,
  UserId,
} from "@bloom/domain";
import { Effect, Layer, Schema, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { MessagesLive, toSseStream } from "../src/http/groups/messages.ts";
import { ThreadsLive } from "../src/http/groups/threads.ts";

const threadId = Schema.decodeSync(ThreadId);
const messageId = Schema.decodeSync(Schema.String.pipe(Schema.brand("MessageId")));

const AuthorizationAllow = Layer.succeed(Authorization)((httpEffect) =>
  Effect.provideService(httpEffect, CurrentUser, {
    id: Schema.decodeSync(UserId)("user-gabby"),
    email: "gabby@example.com",
    name: "Gabby",
  }),
);

const modelError = new ModelError({
  reason: "Upstream",
  provider: "api_key",
  model: "claude-test",
  message: "scripted failure",
});

const start = (id: ThreadId): ChatStreamEvent => ({
  type: "message_start",
  messageId: messageId("m-1"),
  threadId: id,
});
const delta: ChatStreamEvent = { type: "text_delta", messageId: messageId("m-1"), delta: "hi" };
const errorEvent: ChatStreamEvent = { type: "error", message: USER_FACING_MODEL_ERROR };

/** A runner whose stream is scripted per call; records the inputs it received. */
const fakeRunner = (
  script: (input: {
    readonly threadId: ThreadId;
    readonly text: string;
  }) => Stream.Stream<ChatStreamEvent, ModelError | ThreadNotFound>,
  calls: Array<{ readonly threadId: ThreadId; readonly text: string }>,
) =>
  Layer.succeed(
    AgentRunner,
    AgentRunner.of({
      run: (input) => {
        calls.push(input);
        return script(input);
      },
    }),
  );

const makeClient = HttpApiTest.groups(BloomApi, ["threads", "messages"]);

const run = <A, E>(
  runner: Layer.Layer<AgentRunner>,
  body: (client: Effect.Success<typeof makeClient>) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.flatMap(makeClient, body).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mergeAll(ThreadsLive, MessagesLive).pipe(
            Layer.provideMerge(AuthorizationAllow),
            Layer.provide(
              Layer.mergeAll(ThreadService.layerMemory, MessageService.layerMemory, runner),
            ),
          ),
          HttpServer.layerServices,
        ),
      ),
      Effect.scoped,
    ),
  );

describe("toSseStream", () => {
  it("passes events through and ends cleanly after the runner's error event", async () => {
    const events = await Effect.runPromise(
      Stream.runCollect(
        toSseStream(
          Stream.make(start(threadId("t-1")), errorEvent).pipe(
            Stream.concat(Stream.fail(modelError)),
          ),
        ),
      ),
    );
    expect(events.map((event) => event.type)).toEqual(["message_start", "error"]);
  });

  it("turns a ThreadNotFound raised mid-stream into a terminal error event", async () => {
    const events = await Effect.runPromise(
      Stream.runCollect(
        toSseStream(Stream.fail(new ThreadNotFound({ id: threadId("t-missing") }))),
      ),
    );
    expect(events).toEqual([errorEvent]);
  });
});

describe("POST /api/threads/:id/messages", () => {
  it("streams the runner's events in order with the thread and text it was given", async () => {
    const calls: Array<{ readonly threadId: ThreadId; readonly text: string }> = [];
    const events = await run(
      fakeRunner((input) => Stream.make(start(input.threadId), delta), calls),
      (client) =>
        Effect.gen(function* () {
          const main = yield* client.threads.main();
          const stream = yield* client.messages.send({
            params: { id: main.id },
            payload: { text: "hello" },
          });
          const collected = yield* Stream.runCollect(stream);
          expect(calls).toEqual([{ threadId: main.id, text: "hello" }]);
          return collected;
        }),
    );
    expect(events.map((event) => event.type)).toEqual(["message_start", "text_delta"]);
  });

  it("ends the SSE stream cleanly when the runner emits error and then fails", async () => {
    const events = await run(
      fakeRunner(
        (input) =>
          Stream.make(start(input.threadId), errorEvent).pipe(
            Stream.concat(Stream.fail(modelError)),
          ),
        [],
      ),
      (client) =>
        Effect.gen(function* () {
          const main = yield* client.threads.main();
          const stream = yield* client.messages.send({
            params: { id: main.id },
            payload: { text: "hello" },
          });
          return yield* Stream.runCollect(stream);
        }),
    );
    expect(events.map((event) => event.type)).toEqual(["message_start", "error"]);
    expect(events[1]).toEqual(errorEvent);
  });

  it("answers ThreadNotFound (404) for an unknown thread before running the agent", async () => {
    const calls: Array<{ readonly threadId: ThreadId; readonly text: string }> = [];
    const missing = threadId("019a0000-0000-7000-8000-000000000009");
    const error = await run(
      fakeRunner(() => Stream.empty, calls),
      (client) =>
        Effect.flip(client.messages.send({ params: { id: missing }, payload: { text: "hello" } })),
    );
    expect(error._tag).toBe("ThreadNotFound");
    if (error._tag === "ThreadNotFound") {
      expect(error.id).toBe(missing);
    }
    expect(calls).toEqual([]);
  });
});
