import { describe, expect, it } from "bun:test";
import { DateTime, Effect, Layer, Schema } from "effect";
import {
  Capture,
  CaptureId,
  CaptureNotFound,
  CaptureService,
  Device,
  DeviceJson,
  DeviceNotFound,
  DeviceService,
  EventSink,
  MessageId,
  MessageService,
  TaskId,
  TaskService,
  Thread,
  ThreadId,
  ThreadService,
  type IngestResult,
} from "../src/index.ts";

const taskId = Schema.decodeSync(TaskId);
const threadId = Schema.decodeSync(ThreadId);
const messageId = Schema.decodeSync(MessageId);

const millis = (value: DateTime.Utc | null): number | null =>
  value === null ? null : DateTime.toEpochMillis(value);

const layer = Layer.mergeAll(
  TaskService.layerMemory,
  ThreadService.layerMemory,
  MessageService.layerMemory,
  EventSink.layerMemory,
);

const run = <A, E>(
  effect: Effect.Effect<A, E, TaskService | ThreadService | MessageService | EventSink>,
) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

describe("TaskService.layerMemory", () => {
  it("creates, lists, gets, updates, completes and removes", () =>
    run(
      Effect.gen(function* () {
        const tasks = yield* TaskService;
        const created = yield* tasks.create(
          {
            title: "Buy milk",
            notes: null,
            status: "inbox",
            due: null,
            scheduledFor: null,
            effort: 1,
            energyKind: null,
            area: null,
            source: "user",
            parentId: null,
          },
          "user",
        );
        expect(created.status).toBe("inbox");
        expect(created.completedAt).toBeNull();
        expect(typeof created.id).toBe("string");

        const second = yield* tasks.create(
          {
            title: "Call dentist",
            notes: null,
            status: "next",
            due: null,
            scheduledFor: null,
            effort: null,
            energyKind: "social",
            area: null,
            source: "agent",
            parentId: null,
          },
          "agent",
        );

        expect((yield* tasks.list()).map((task) => task.id)).toEqual([created.id, second.id]);
        expect((yield* tasks.list({ status: ["next"] })).map((task) => task.id)).toEqual([
          second.id,
        ]);

        const fetched = yield* tasks.get(created.id);
        expect(fetched.title).toBe("Buy milk");

        const updated = yield* tasks.update(
          created.id,
          { title: "Buy oat milk", effort: 2 },
          "user",
        );
        expect(updated.title).toBe("Buy oat milk");
        expect(updated.effort).toBe(2);
        expect(updated.status).toBe("inbox");
        expect(DateTime.toEpochMillis(updated.updatedAt)).toBeGreaterThanOrEqual(
          DateTime.toEpochMillis(created.updatedAt),
        );

        const completed = yield* tasks.complete(created.id, "user");
        expect(completed.status).toBe("done");
        expect(completed.completedAt).not.toBeNull();

        const reopened = yield* tasks.update(created.id, { status: "next" }, "user");
        expect(reopened.completedAt).toBeNull();

        yield* tasks.remove(second.id, "user");
        expect((yield* tasks.list()).map((task) => task.id)).toEqual([created.id]);
      }),
    ));

  it("lists in creation order even when tasks are created in the same millisecond", () =>
    run(
      Effect.gen(function* () {
        const tasks = yield* TaskService;
        const ids: Array<TaskId> = [];
        for (let i = 0; i < 200; i++) {
          const task = yield* tasks.create(
            {
              title: `t${i}`,
              notes: null,
              status: "inbox",
              due: null,
              scheduledFor: null,
              effort: null,
              energyKind: null,
              area: null,
              source: "user",
              parentId: null,
            },
            "user",
          );
          ids.push(task.id);
        }
        expect((yield* tasks.list()).map((task) => task.id)).toEqual(ids);
      }),
    ));

  it("owns completedAt: set on create when status is done", () =>
    run(
      Effect.gen(function* () {
        const tasks = yield* TaskService;
        const done = yield* tasks.create(
          {
            title: "Already done",
            notes: null,
            status: "done",
            due: null,
            scheduledFor: null,
            effort: null,
            energyKind: null,
            area: null,
            source: "import",
            parentId: null,
          },
          "user",
        );
        expect(done.completedAt).not.toBeNull();
        const stillDone = yield* tasks.update(done.id, { title: "Renamed" }, "user");
        expect(millis(stillDone.completedAt)).toBe(millis(done.completedAt));
      }),
    ));

  it("fails with TaskNotFound for unknown ids", () =>
    run(
      Effect.gen(function* () {
        const tasks = yield* TaskService;
        const missing = taskId("missing");
        const getError = yield* Effect.flip(tasks.get(missing));
        expect(getError._tag).toBe("TaskNotFound");
        expect(getError.id).toBe(missing);
        expect((yield* Effect.flip(tasks.update(missing, { title: "x" }, "user")))._tag).toBe(
          "TaskNotFound",
        );
        expect((yield* Effect.flip(tasks.complete(missing, "user")))._tag).toBe("TaskNotFound");
        expect((yield* Effect.flip(tasks.remove(missing, "user")))._tag).toBe("TaskNotFound");
      }),
    ));
});

describe("ThreadService.layerMemory", () => {
  it("ensureMain is idempotent and touch updates lastMessageAt", () =>
    run(
      Effect.gen(function* () {
        const threads = yield* ThreadService;
        const main = yield* threads.ensureMain;
        const again = yield* threads.ensureMain;
        expect(main.kind).toBe("main");
        expect(again.id).toBe(main.id);
        expect((yield* threads.list).filter((thread) => thread.kind === "main")).toHaveLength(1);

        const side = yield* threads.create({
          kind: "side",
          parentThreadId: main.id,
          topic: "Trip",
          contextScope: "minimal",
          status: "active",
        });
        expect((yield* threads.get(side.id)).parentThreadId).toBe(main.id);
        expect(side.lastMessageAt).toBeNull();

        const at = DateTime.makeUnsafe("2026-10-04T12:00:00Z");
        yield* threads.touch(main.id, at);
        const touched = yield* threads.get(main.id);
        expect(
          touched.lastMessageAt === null ? null : DateTime.formatIso(touched.lastMessageAt),
        ).toBe("2026-10-04T12:00:00.000Z");

        const missing = threadId("missing");
        expect((yield* Effect.flip(threads.get(missing)))._tag).toBe("ThreadNotFound");
        expect((yield* Effect.flip(threads.touch(missing, at)))._tag).toBe("ThreadNotFound");
      }),
    ));

  it("applies the kind-based contextScope default when the input omits it", () =>
    run(
      Effect.gen(function* () {
        const threads = yield* ThreadService;
        const main = yield* threads.ensureMain;
        expect(main.contextScope).toBe("full");

        const side = yield* threads.create(
          yield* Schema.decodeEffect(Thread.jsonCreate)({ kind: "side", parentThreadId: main.id }),
        );
        expect(side.contextScope).toBe("minimal");

        const quest = yield* threads.create(
          yield* Schema.decodeEffect(Thread.jsonCreate)({ kind: "quest" }),
        );
        expect(quest.contextScope).toBe("full");

        const explicit = yield* threads.create(
          yield* Schema.decodeEffect(Thread.jsonCreate)({ kind: "side", contextScope: "full" }),
        );
        expect(explicit.contextScope).toBe("full");

        expect((yield* threads.list).map((thread) => thread.id)).toEqual([
          main.id,
          side.id,
          quest.id,
          explicit.id,
        ]);
      }),
    ));
});

describe("MessageService.layerMemory", () => {
  it("appends in order, lists with limit, replaces parts", () =>
    run(
      Effect.gen(function* () {
        const messages = yield* MessageService;
        const mainThreadId = threadId("th1");
        const first = yield* messages.append({
          threadId: mainThreadId,
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        });
        const second = yield* messages.append({
          threadId: mainThreadId,
          role: "assistant",
          parts: [{ type: "text", text: "hello" }],
          runId: null,
        });
        yield* messages.append({
          threadId: threadId("other"),
          role: "user",
          parts: [{ type: "text", text: "elsewhere" }],
        });
        expect(first.runId).toBeNull();
        expect((yield* messages.list(mainThreadId)).map((message) => message.id)).toEqual([
          first.id,
          second.id,
        ]);
        expect(
          (yield* messages.list(mainThreadId, { limit: 1 })).map((message) => message.id),
        ).toEqual([second.id]);

        const replaced = yield* messages.replaceParts(second.id, [
          { type: "text", text: "hello" },
          { type: "tool_call", id: "c1", name: "create_task", args: {} },
        ]);
        expect(replaced.parts).toHaveLength(2);
        expect((yield* messages.list(mainThreadId))[1]?.parts).toHaveLength(2);

        const error = yield* Effect.flip(messages.replaceParts(messageId("missing"), []));
        expect(error._tag).toBe("MessageNotFound");
      }),
    ));

  it("keeps append order for messages appended within the same millisecond", () =>
    run(
      Effect.gen(function* () {
        const messages = yield* MessageService;
        const thread = threadId("burst");
        const ids: Array<MessageId> = [];
        for (let i = 0; i < 500; i++) {
          const message = yield* messages.append({
            threadId: thread,
            role: i % 2 === 0 ? "user" : "assistant",
            parts: [{ type: "text", text: `m${i}` }],
          });
          ids.push(message.id);
        }
        expect((yield* messages.list(thread)).map((message) => message.id)).toEqual(ids);
        expect((yield* messages.list(thread, { limit: 3 })).map((message) => message.id)).toEqual(
          ids.slice(-3),
        );
        // Replacing parts must not move a message in the order.
        const target = ids[250];
        if (target === undefined) {
          throw new Error("expected 500 ids");
        }
        yield* messages.replaceParts(target, [{ type: "text", text: "edited" }]);
        expect((yield* messages.list(thread)).map((message) => message.id)).toEqual(ids);
      }),
    ));
});

describe("EventSink.layerMemory", () => {
  it("inserts new events and dedupes by key", () =>
    run(
      Effect.gen(function* () {
        const sink = yield* EventSink;
        const occurredAt = DateTime.nowUnsafe();
        const first: IngestResult = yield* sink.ingest({
          source: "gmail",
          type: "message.received",
          occurredAt,
          payload: { id: "m1" },
          dedupeKey: "gmail:m1",
        });
        expect(first._tag).toBe("Inserted");
        if (first._tag === "Inserted") {
          expect(first.event.dedupeKey).toBe("gmail:m1");
          expect(first.event.payload).toEqual({ id: "m1" });
        }

        const dup = yield* sink.ingest({
          source: "gmail",
          type: "message.received",
          occurredAt,
          payload: { id: "m1" },
          dedupeKey: "gmail:m1",
        });
        expect(dup).toEqual({ _tag: "Duplicate", dedupeKey: "gmail:m1" });

        const noKey = yield* sink.ingest({
          source: "system",
          type: "tick",
          occurredAt,
          payload: null,
        });
        const noKeyAgain = yield* sink.ingest({
          source: "system",
          type: "tick",
          occurredAt,
          payload: null,
        });
        expect(noKey._tag).toBe("Inserted");
        expect(noKeyAgain._tag).toBe("Inserted");
      }),
    ));
});

describe("CaptureService.layerMemory", () => {
  const runCaptures = <A, E>(effect: Effect.Effect<A, E, CaptureService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(CaptureService.layerMemory)));

  it("creates with defaults, lists in creation order, filters by status and triages", () =>
    runCaptures(
      Effect.gen(function* () {
        const captures = yield* CaptureService;
        const decode = Schema.decodeSync(Capture.jsonCreate);
        const link = yield* captures.create(
          decode({ kind: "share", payload: { url: "https://example.com/article" } }),
          "user",
        );
        expect(link.status).toBe("new");
        expect(link.transcript).toBeNull();
        expect(link.routedTo).toBeNull();
        const note = yield* captures.create(
          decode({ kind: "text", payload: { text: "Buy stamps" } }),
          "user",
        );

        expect((yield* captures.list()).map((capture) => capture.id)).toEqual([link.id, note.id]);

        const routed = yield* captures.update(
          note.id,
          { status: "routed", routedTo: "task:t1" },
          "agent",
        );
        expect(routed.status).toBe("routed");
        expect(routed.routedTo).toBe("task:t1");
        expect(routed.payload).toEqual({ text: "Buy stamps" });
        expect(routed.kind).toBe("text");

        expect((yield* captures.list({ status: ["new"] })).map((capture) => capture.id)).toEqual([
          link.id,
        ]);
        expect((yield* captures.get(link.id)).payload).toEqual({
          url: "https://example.com/article",
        });
      }),
    ));

  it("fails with CaptureNotFound for unknown ids", () =>
    runCaptures(
      Effect.gen(function* () {
        const captures = yield* CaptureService;
        const missing = Schema.decodeSync(CaptureId)("019a0000-0000-7000-8000-00000000dead");
        const error = yield* Effect.flip(captures.get(missing));
        expect(error._tag).toBe("CaptureNotFound");
        const patchError = yield* Effect.flip(
          captures.update(missing, { status: "dismissed" }, "user"),
        );
        expect(patchError).toBeInstanceOf(CaptureNotFound);
      }),
    ));
});

describe("DeviceService.layerMemory", () => {
  const runDevices = <A, E>(effect: Effect.Effect<A, E, DeviceService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(DeviceService.layerMemory)));
  const decodeRegister = Schema.decodeSync(Device.jsonCreate);

  it("registers once per push token and updates on re-registration", () =>
    runDevices(
      Effect.gen(function* () {
        const devices = yield* DeviceService;
        const first = yield* devices.register(
          decodeRegister({ platform: "ios", pushToken: "abc123", pushEnvironment: "sandbox" }),
        );
        expect(first.name).toBeNull();
        const again = yield* devices.register(
          decodeRegister({
            platform: "ios",
            pushToken: "abc123",
            pushEnvironment: "production",
            name: "Gabby's iPhone",
            appVersion: "0.1.0 (1)",
          }),
        );
        expect(again.id).toBe(first.id);
        expect(again.pushEnvironment).toBe("production");
        expect(again.name).toBe("Gabby's iPhone");
        const other = yield* devices.register(
          decodeRegister({ platform: "ios", pushToken: "def456", pushEnvironment: "sandbox" }),
        );
        expect((yield* devices.list).map((device) => device.id)).toEqual([first.id, other.id]);

        yield* devices.remove(first.id);
        expect((yield* devices.list).map((device) => device.id)).toEqual([other.id]);
        expect(yield* Effect.flip(devices.remove(first.id))).toBeInstanceOf(DeviceNotFound);
      }),
    ));

  it("never puts the push token in the JSON shape", () =>
    runDevices(
      Effect.gen(function* () {
        const devices = yield* DeviceService;
        const device = yield* devices.register(
          decodeRegister({
            platform: "ios",
            pushToken: "secret-token",
            pushEnvironment: "sandbox",
          }),
        );
        const json = Schema.encodeSync(DeviceJson)(device);
        expect(Object.keys(json)).not.toContain("pushToken");
        expect(JSON.stringify(json)).not.toContain("secret-token");
      }),
    ));
});
