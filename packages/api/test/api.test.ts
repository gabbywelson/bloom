import { describe, expect, it } from "bun:test";
import { CaptureId, TaskId, ThreadId } from "@bloom/domain";
import { Cause, DateTime, Effect, Exit, Layer, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse, HttpServer, HttpServerRespondable } from "effect/http";
import { HttpApiError, HttpApiTest } from "effect/http-api";
import { BloomApi } from "../src/api.ts";
import type { Authorization } from "../src/auth.ts";
import { makeBloomClient } from "../src/client.ts";
import { AuthorizationAllow, AuthorizationReject, fixedUser, TestHandlers } from "./handlers.ts";

const taskId = Schema.decodeSync(TaskId);
const threadId = Schema.decodeSync(ThreadId);

const makeClient = HttpApiTest.groups(BloomApi, [
  "health",
  "me",
  "threads",
  "messages",
  "tasks",
  "captures",
  "events",
  "devices",
]);

type Client = Effect.Success<typeof makeClient>;

/** Runs a test body against a fresh in-memory API with the given Authorization implementation. */
const run = <A, E>(
  body: (client: Client) => Effect.Effect<A, E>,
  authorization: Layer.Layer<Authorization> = AuthorizationAllow,
): Promise<A> =>
  Effect.runPromise(
    Effect.flatMap(makeClient, body).pipe(
      Effect.provide(
        Layer.mergeAll(
          TestHandlers.pipe(Layer.provideMerge(authorization)),
          HttpServer.layerServices,
        ),
      ),
      Effect.scoped,
    ),
  );

/** The create payload is the encoded side of `Task.jsonCreate`: only `title` is required. */
const minimalTask = { title: "Buy milk" } as const;

describe("health", () => {
  it("GET /api/health reports ok without authorization", () =>
    run(
      (client) =>
        Effect.gen(function* () {
          const health = yield* client.health.check();
          expect(health.status).toBe("ok");
          expect(health.service).toBe("bloom-server");
          expect(DateTime.isDateTime(health.time)).toBe(true);
        }),
      AuthorizationReject,
    ));
});

describe("me", () => {
  it("GET /api/me returns the current user", () =>
    run((client) =>
      Effect.gen(function* () {
        const me = yield* client.me.get();
        expect(me).toEqual(fixedUser);
      }),
    ));

  it("fails with Unauthorized when the middleware rejects", () =>
    run(
      (client) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(client.me.get());
          expect(error._tag).toBe("Unauthorized");
          if (error._tag === "Unauthorized") {
            expect(error.message).toBe("No session cookie");
          }
        }),
      AuthorizationReject,
    ));
});

describe("tasks", () => {
  it("creates, lists, filters, gets, patches, completes and deletes", () =>
    run((client) =>
      Effect.gen(function* () {
        expect(yield* client.tasks.list({ query: {} })).toEqual([]);

        const milk = yield* client.tasks.create({ payload: minimalTask });
        expect(milk.title).toBe("Buy milk");
        expect(milk.status).toBe("inbox");
        expect(milk.completedAt).toBeNull();
        expect(DateTime.isDateTime(milk.createdAt)).toBe(true);

        const dentist = yield* client.tasks.create({
          payload: {
            title: "Call dentist",
            status: "next",
            effort: 2,
            energyKind: "social",
            due: "2026-10-10T09:00:00Z",
          },
        });
        expect(dentist.effort).toBe(2);
        expect(dentist.due === null ? null : DateTime.formatIso(dentist.due)).toBe(
          "2026-10-10T09:00:00.000Z",
        );

        const all = yield* client.tasks.list({ query: {} });
        expect(all.map((task) => task.id)).toEqual([milk.id, dentist.id]);

        const next = yield* client.tasks.list({ query: { status: ["next"] } });
        expect(next.map((task) => task.id)).toEqual([dentist.id]);

        const both = yield* client.tasks.list({ query: { status: ["inbox", "next"] } });
        expect(both).toHaveLength(2);

        const fetched = yield* client.tasks.get({ params: { id: milk.id } });
        expect(fetched.id).toBe(milk.id);
        expect(fetched.title).toBe("Buy milk");

        const patched = yield* client.tasks.update({
          params: { id: milk.id },
          payload: { title: "Buy oat milk" },
        });
        expect(patched.title).toBe("Buy oat milk");
        expect(patched.status).toBe("inbox");
        expect(patched.notes).toBeNull();
        expect(patched.effort).toBeNull();

        const completed = yield* client.tasks.complete({ params: { id: milk.id } });
        expect(completed.status).toBe("done");
        expect(completed.completedAt).not.toBeNull();

        yield* client.tasks.remove({ params: { id: dentist.id } });
        const remaining = yield* client.tasks.list({ query: {} });
        expect(remaining.map((task) => task.id)).toEqual([milk.id]);
      }),
    ));

  /**
   * `decodePayload` raises the same `HttpApiSchemaError` the builder uses for
   * its own payload failures. A real server turns that defect into an empty
   * 400 via `HttpServerError.causeResponse`; the in-memory `HttpApiTest`
   * harness does not model that step, so assert on the defect and on the
   * response it renders to.
   */
  it("rejects a create payload whose timestamp does not parse as a 400 Payload error", () =>
    run((client) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          client.tasks.create({ payload: { title: "Bad date", due: "not-a-date" } }),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (!Exit.isFailure(exit)) {
          return;
        }
        const defect = Cause.squash(exit.cause);
        expect(HttpApiError.HttpApiSchemaError.is(defect)).toBe(true);
        if (!HttpApiError.HttpApiSchemaError.is(defect)) {
          return;
        }
        expect(defect.kind).toBe("Payload");
        const response = yield* HttpServerRespondable.toResponse(defect);
        expect(response.status).toBe(400);

        expect(yield* client.tasks.list({ query: {} })).toEqual([]);
      }),
    ));

  it("returns TaskNotFound (404) for unknown ids", () =>
    run((client) =>
      Effect.gen(function* () {
        const missing = taskId("019a0000-0000-7000-8000-000000000000");

        const get = yield* Effect.flip(client.tasks.get({ params: { id: missing } }));
        expect(get._tag).toBe("TaskNotFound");
        if (get._tag === "TaskNotFound") {
          expect(get.id).toBe(missing);
        }

        const update = yield* Effect.flip(
          client.tasks.update({ params: { id: missing }, payload: { title: "x" } }),
        );
        expect(update._tag).toBe("TaskNotFound");

        const complete = yield* Effect.flip(client.tasks.complete({ params: { id: missing } }));
        expect(complete._tag).toBe("TaskNotFound");

        const remove = yield* Effect.flip(client.tasks.remove({ params: { id: missing } }));
        expect(remove._tag).toBe("TaskNotFound");
      }),
    ));

  it("is rejected without authorization", () =>
    run(
      (client) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(client.tasks.list({ query: {} }));
          expect(error._tag).toBe("Unauthorized");
        }),
      AuthorizationReject,
    ));
});

describe("threads", () => {
  it("lists, creates, gets and lists messages", () =>
    run((client) =>
      Effect.gen(function* () {
        expect(yield* client.threads.list()).toEqual([]);

        const side = yield* client.threads.create({
          payload: { kind: "side", topic: "Rabbit hole" },
        });
        expect(side.kind).toBe("side");
        expect(side.contextScope).toBe("minimal");
        expect(side.parentThreadId).toBeNull();
        expect(side.status).toBe("active");
        expect(side.lastMessageAt).toBeNull();

        const quest = yield* client.threads.create({
          payload: { kind: "quest", topic: "Move house", contextScope: "minimal" },
        });
        expect(quest.kind).toBe("quest");
        expect(quest.contextScope).toBe("minimal");

        const listed = yield* client.threads.list();
        expect(listed.map((thread) => thread.id)).toEqual([side.id, quest.id]);

        const fetched = yield* client.threads.get({ params: { id: side.id } });
        expect(fetched.topic).toBe("Rabbit hole");

        expect(yield* client.threads.messages({ params: { id: side.id }, query: {} })).toEqual([]);

        yield* Stream.runDrain(
          yield* client.messages.send({ params: { id: side.id }, payload: { text: "one" } }),
        );
        yield* Stream.runDrain(
          yield* client.messages.send({ params: { id: side.id }, payload: { text: "two" } }),
        );

        const messages = yield* client.threads.messages({ params: { id: side.id }, query: {} });
        expect(messages.map((message) => message.role)).toEqual([
          "user",
          "assistant",
          "user",
          "assistant",
        ]);
        expect(messages[0]?.parts).toEqual([{ type: "text", text: "one" }]);

        const recent = yield* client.threads.messages({
          params: { id: side.id },
          query: { limit: 2 },
        });
        expect(recent.map((message) => message.role)).toEqual(["user", "assistant"]);
        expect(recent[0]?.parts).toEqual([{ type: "text", text: "two" }]);

        expect(yield* client.threads.messages({ params: { id: quest.id }, query: {} })).toEqual([]);
      }),
    ));

  it("GET /api/threads/main returns the single main thread, creating it once", () =>
    run((client) =>
      Effect.gen(function* () {
        expect(yield* client.threads.list()).toEqual([]);

        const main = yield* client.threads.main();
        expect(main.kind).toBe("main");
        expect(main.contextScope).toBe("full");

        const again = yield* client.threads.main();
        expect(again.id).toBe(main.id);

        // The static /main route must win over /:id.
        const fetched = yield* client.threads.get({ params: { id: main.id } });
        expect(fetched.id).toBe(main.id);

        const listed = yield* client.threads.list();
        expect(listed.map((thread) => thread.kind)).toEqual(["main"]);
      }),
    ));

  it("cannot create a second main thread through POST /api/threads", () =>
    run((client) =>
      Effect.gen(function* () {
        const main = yield* client.threads.main();
        // The contract narrows `kind` to side | quest. Bypass the type: the client
        // refuses to encode the payload (the server decodes with the same schema and
        // would answer 400), so nothing is created.
        const error = yield* Effect.flip(
          client.threads.create({ payload: { kind: "main" as "side" } }),
        );
        expect(error._tag).toBe("SchemaError");

        const listed = yield* client.threads.list();
        expect(listed.map((thread) => thread.id)).toEqual([main.id]);
      }),
    ));

  it("returns ThreadNotFound (404) for unknown ids", () =>
    run((client) =>
      Effect.gen(function* () {
        const missing = threadId("019a0000-0000-7000-8000-000000000001");

        const get = yield* Effect.flip(client.threads.get({ params: { id: missing } }));
        expect(get._tag).toBe("ThreadNotFound");
        if (get._tag === "ThreadNotFound") {
          expect(get.id).toBe(missing);
        }

        const messages = yield* Effect.flip(
          client.threads.messages({ params: { id: missing }, query: {} }),
        );
        expect(messages._tag).toBe("ThreadNotFound");

        const send = yield* Effect.flip(
          client.messages.send({ params: { id: missing }, payload: { text: "hello" } }),
        );
        expect(send._tag).toBe("ThreadNotFound");
      }),
    ));
});

describe("messages (SSE)", () => {
  it("streams decoded ChatStreamEvents in order", () =>
    run((client) =>
      Effect.gen(function* () {
        const thread = yield* client.threads.main();

        const stream = yield* client.messages.send({
          params: { id: thread.id },
          payload: { text: "hello bloom" },
        });
        const events = yield* Stream.runCollect(stream);

        expect(events.map((event) => event.type)).toEqual([
          "message_start",
          "text_delta",
          "message_end",
        ]);

        const [start, delta, end] = events;
        if (
          start?.type !== "message_start" ||
          delta?.type !== "text_delta" ||
          end?.type !== "message_end"
        ) {
          return yield* Effect.die(new Error("unexpected event order"));
        }
        expect(start.threadId).toBe(thread.id);
        expect(delta.messageId).toBe(start.messageId);
        expect(delta.delta).toBe("echo: hello bloom");
        expect(end.message.id).toBe(start.messageId);
        expect(end.message.role).toBe("assistant");
        expect(end.message.parts).toEqual([{ type: "text", text: "echo: hello bloom" }]);
        expect(DateTime.isDateTime(end.message.createdAt)).toBe(true);
      }),
    ));

  it("is rejected without authorization", () =>
    run(
      (client) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            client.messages.send({
              params: { id: threadId("019a0000-0000-7000-8000-000000000002") },
              payload: { text: "hello" },
            }),
          );
          expect(error._tag).toBe("Unauthorized");
        }),
      AuthorizationReject,
    ));
});

describe("client", () => {
  it("requests /api/<path> exactly once under the given origin (no doubled /api)", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const urls: Array<string> = [];
        const recording = HttpClient.make((request, url) => {
          urls.push(url.toString());
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  status: "ok",
                  service: "bloom-server",
                  time: "2026-10-04T00:00:00.000Z",
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            ),
          );
        });
        const client = yield* makeBloomClient({ baseUrl: "http://bloom.test" }).pipe(
          Effect.provideService(HttpClient.HttpClient, recording),
        );
        const health = yield* client.health.check();
        expect(health.status).toBe("ok");
        expect(urls).toEqual(["http://bloom.test/api/health"]);
      }),
    ));
});

describe("captures", () => {
  it("files captures with only kind and payload, lists by status and triages", () =>
    run((client) =>
      Effect.gen(function* () {
        const link = yield* client.captures.create({
          payload: { kind: "share", payload: { url: "https://example.com/a", title: "A" } },
        });
        expect(link.status).toBe("new");
        expect(link.transcript).toBeNull();
        expect(link.payload).toEqual({ url: "https://example.com/a", title: "A" });
        const note = yield* client.captures.create({
          payload: { kind: "text", payload: { text: "Buy stamps" } },
        });

        expect((yield* client.captures.list({ query: {} })).map((c) => c.id)).toEqual([
          link.id,
          note.id,
        ]);
        const dismissed = yield* client.captures.update({
          params: { id: note.id },
          payload: { status: "dismissed" },
        });
        expect(dismissed.status).toBe("dismissed");
        expect(dismissed.payload).toEqual({ text: "Buy stamps" });

        const fresh = yield* client.captures.list({ query: { status: ["new"] } });
        expect(fresh.map((c) => c.id)).toEqual([link.id]);
        expect((yield* client.captures.get({ params: { id: link.id } })).kind).toBe("share");
      }),
    ));

  it("answers CaptureNotFound (404) for unknown ids", () =>
    run((client) =>
      Effect.gen(function* () {
        const id = Schema.decodeSync(CaptureId)("019a0000-0000-7000-8000-00000000dead");
        const error = yield* Effect.flip(client.captures.get({ params: { id } }));
        expect(error._tag).toBe("CaptureNotFound");
        const patchError = yield* Effect.flip(
          client.captures.update({ params: { id }, payload: { status: "routed" } }),
        );
        expect(patchError._tag).toBe("CaptureNotFound");
      }),
    ));

  it("requires authorization", () =>
    run(
      (client) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(client.captures.list({ query: {} }));
          expect(error._tag).toBe("Unauthorized");
        }),
      AuthorizationReject,
    ));
});

describe("events", () => {
  const summary = {
    source: "healthkit",
    type: "daily_summary",
    occurredAt: "2026-10-04T07:00:00.000Z",
    payload: { day: "2026-10-04", steps: 8123 },
    dedupeKey: "healthkit:2026-10-04",
  };

  it("ingests once per dedupeKey and answers Duplicate after", () =>
    run((client) =>
      Effect.gen(function* () {
        const first = yield* client.events.ingest({ payload: summary });
        expect(first._tag).toBe("Inserted");
        if (first._tag === "Inserted") {
          expect(first.event.source).toBe("healthkit");
          expect(first.event.dedupeKey).toBe("healthkit:2026-10-04");
          expect(first.event.payload).toEqual({ day: "2026-10-04", steps: 8123 });
        }
        const again = yield* client.events.ingest({ payload: summary });
        expect(again).toEqual({ _tag: "Duplicate", dedupeKey: "healthkit:2026-10-04" });
      }),
    ));

  it("refuses the server's own sources", () =>
    run((client) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          client.events.ingest({ payload: { ...summary, source: "domain" } }),
        );
        expect(error._tag).toBe("InvalidEventSource");
      }),
    ));
});

describe("devices", () => {
  it("registers once per token, never returns the token, lists and removes", () =>
    run((client) =>
      Effect.gen(function* () {
        const payload = {
          platform: "ios",
          pushToken: "tok-1",
          pushEnvironment: "sandbox",
        } as const;
        const device = yield* client.devices.register({ payload });
        expect(Object.keys(device)).not.toContain("pushToken");
        const again = yield* client.devices.register({
          payload: { ...payload, name: "iPhone", appVersion: "0.1.0 (1)" },
        });
        expect(again.id).toBe(device.id);
        expect(again.name).toBe("iPhone");
        expect((yield* client.devices.list()).map((d) => d.id)).toEqual([device.id]);
        yield* client.devices.remove({ params: { id: device.id } });
        expect(yield* client.devices.list()).toEqual([]);
        const error = yield* Effect.flip(client.devices.remove({ params: { id: device.id } }));
        expect(error._tag).toBe("DeviceNotFound");
      }),
    ));
});
