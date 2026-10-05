/**
 * Test-only handlers for `BloomApi`. They exercise the contract against the
 * domain `layerMemory` layers; the real handlers live in `apps/server`.
 */
import {
  Capture,
  CaptureService,
  type ChatStreamEvent,
  MessageService,
  Task,
  TaskService,
  Thread,
  ThreadService,
  UserId,
} from "@bloom/domain";
import { DateTime, Effect, Layer, Schema, Stream } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { BloomApi } from "../src/api.ts";
import { Authorization, type AuthUser, CurrentUser, Unauthorized } from "../src/auth.ts";
import { decodePayload } from "../src/payload.ts";

const decodeTaskCreate = decodePayload(Task.jsonCreate);
const decodeCaptureCreate = decodePayload(Capture.jsonCreate);
const decodeThreadCreate = decodePayload(Thread.jsonCreate);

/** The single owner every allowed request runs as. */
export const fixedUser: AuthUser = {
  id: Schema.decodeSync(UserId)("user-gabby"),
  email: "gabby@example.com",
  name: "Gabby",
};

/** Authorization that accepts every request and provides `fixedUser`. */
export const AuthorizationAllow = Layer.succeed(Authorization)((httpEffect) =>
  Effect.provideService(httpEffect, CurrentUser, fixedUser),
);

/** Authorization that rejects every request with `Unauthorized`. */
export const AuthorizationReject = Layer.succeed(Authorization)(() =>
  Effect.fail(new Unauthorized({ message: "No session cookie" })),
);

export const HealthHandlers = HttpApiBuilder.group(BloomApi, "health", (handlers) =>
  handlers.handle("check", () =>
    Effect.map(DateTime.now, (time) => ({
      status: "ok" as const,
      service: "bloom-server" as const,
      time,
    })),
  ),
);

export const MeHandlers = HttpApiBuilder.group(BloomApi, "me", (handlers) =>
  handlers.handle("get", () => CurrentUser),
);

export const ThreadsHandlers = HttpApiBuilder.group(
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

/**
 * Stand-in for the agent: records the user turn, writes an echo reply and
 * streams three events for it.
 */
export const MessagesHandlers = HttpApiBuilder.group(
  BloomApi,
  "messages",
  Effect.fn(function* (handlers) {
    const threads = yield* ThreadService;
    const messages = yield* MessageService;
    return handlers.handle(
      "send",
      Effect.fn(function* ({ params, payload }) {
        yield* threads.get(params.id);
        yield* messages.append({
          threadId: params.id,
          role: "user",
          parts: [{ type: "text", text: payload.text }],
        });
        const replyText = `echo: ${payload.text}`;
        const reply = yield* messages.append({
          threadId: params.id,
          role: "assistant",
          parts: [{ type: "text", text: replyText }],
        });
        const events: ReadonlyArray<ChatStreamEvent> = [
          { type: "message_start", messageId: reply.id, threadId: params.id },
          { type: "text_delta", messageId: reply.id, delta: replyText },
          { type: "message_end", message: reply },
        ];
        return Stream.make(...events);
      }),
    );
  }),
);

export const TasksHandlers = HttpApiBuilder.group(
  BloomApi,
  "tasks",
  Effect.fn(function* (handlers) {
    const tasks = yield* TaskService;
    return handlers.handleAll({
      list: ({ query }) =>
        tasks.list(query.status === undefined ? undefined : { status: query.status }),
      create: ({ payload }) =>
        Effect.flatMap(decodeTaskCreate(payload), (input) => tasks.create(input, "user")),
      get: ({ params }) => tasks.get(params.id),
      update: ({ params, payload }) => tasks.update(params.id, payload, "user"),
      complete: ({ params }) => tasks.complete(params.id, "user"),
      remove: ({ params }) => tasks.remove(params.id, "user"),
    });
  }),
);

export const CapturesHandlers = HttpApiBuilder.group(
  BloomApi,
  "captures",
  Effect.fn(function* (handlers) {
    const captures = yield* CaptureService;
    return handlers.handleAll({
      create: ({ payload }) =>
        Effect.flatMap(decodeCaptureCreate(payload), (input) => captures.create(input, "user")),
      list: ({ query }) =>
        captures.list(query.status === undefined ? undefined : { status: query.status }),
      get: ({ params }) => captures.get(params.id),
      update: ({ params, payload }) => captures.update(params.id, payload, "user"),
    });
  }),
);

/** Every group's test handlers over fresh in-memory domain services. */
export const TestHandlers = Layer.mergeAll(
  HealthHandlers,
  MeHandlers,
  ThreadsHandlers,
  MessagesHandlers,
  TasksHandlers,
  CapturesHandlers,
).pipe(
  Layer.provide(
    Layer.mergeAll(
      TaskService.layerMemory,
      ThreadService.layerMemory,
      MessageService.layerMemory,
      CaptureService.layerMemory,
    ),
  ),
);
