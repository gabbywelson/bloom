import { describe, expect, it } from "bun:test";
import { DateTime, Effect, Schema } from "effect";
import {
  Capture,
  Event,
  EventId,
  Message,
  Nudge,
  Task,
  TaskId,
  Thread,
  ThreadId,
} from "../src/index.ts";

const isIsoString = (value: unknown): boolean =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) && value.endsWith("Z");

const millis = (value: DateTime.Utc | null): number | null =>
  value === null ? null : DateTime.toEpochMillis(value);

/** Simulates the wire: serialize to a JSON string and parse back as `unknown`. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const isJsonObject = (json: Schema.Json): json is Schema.JsonObject =>
  json !== null && typeof json === "object" && !Array.isArray(json);

/** Narrows an encoded `Schema.Json` value to an object so fields can be inspected. */
const obj = (json: Schema.Json): Schema.JsonObject => {
  if (!isJsonObject(json)) {
    throw new Error("expected a JSON object");
  }
  return json;
};

const taskId = Schema.decodeSync(TaskId);
const threadId = Schema.decodeSync(ThreadId);
const eventId = Schema.decodeSync(EventId);

describe("Task", () => {
  const json = Schema.toCodecJson(Task.json);

  it("round-trips through the JSON contract", async () => {
    const task = new Task(
      await Effect.runPromise(
        Task.insert.makeEffect({
          title: "Buy milk",
          notes: "2%",
          status: "next",
          due: DateTime.makeUnsafe("2026-10-06T09:00:00Z"),
          effort: 2,
          energyKind: "admin",
          area: "Home",
          source: "user",
        }),
      ),
    );
    expect(typeof task.id).toBe("string");
    expect(task.scheduledFor).toBeNull();
    expect(task.parentId).toBeNull();
    expect(task.completedAt).toBeNull();

    const encoded = obj(Schema.encodeSync(json)(task));
    expect(typeof encoded.id).toBe("string");
    expect(isIsoString(encoded.createdAt)).toBe(true);
    expect(isIsoString(encoded.updatedAt)).toBe(true);
    expect(encoded.due).toBe("2026-10-06T09:00:00.000Z");
    expect(encoded.scheduledFor).toBeNull();
    expect(wire(encoded)).toEqual(encoded);

    const decoded = Schema.decodeUnknownSync(json)(wire(encoded));
    expect(decoded.id).toBe(task.id);
    expect(decoded.title).toBe(task.title);
    expect(decoded.status).toBe("next");
    expect(decoded.effort).toBe(2);
    expect(millis(decoded.due)).toBe(millis(task.due));
    expect(millis(decoded.createdAt)).toBe(millis(task.createdAt));
    expect(millis(decoded.updatedAt)).toBe(millis(task.updatedAt));
    expect(Schema.encodeSync(json)(decoded)).toEqual(encoded);
  });

  it("encodes DB variants with Date timestamps", async () => {
    const task = await Effect.runPromise(Task.insert.makeEffect({ title: "x" }));
    const encoded = Schema.encodeSync(Task.insert)(task);
    expect(encoded.createdAt).toBeInstanceOf(Date);
    expect(encoded.updatedAt).toBeInstanceOf(Date);
    expect(encoded.due).toBeNull();
    const selected = Schema.decodeSync(Task)({
      ...encoded,
      due: new Date("2026-01-01T00:00:00Z"),
    });
    expect(selected).toBeInstanceOf(Task);
    expect(selected.due === null ? null : DateTime.formatIso(selected.due)).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("decodes a minimal jsonCreate payload with defaults", () => {
    const created = Schema.decodeSync(Schema.toCodecJson(Task.jsonCreate))({
      title: "Buy milk",
    });
    expect(created).toEqual({
      title: "Buy milk",
      notes: null,
      status: "inbox",
      due: null,
      scheduledFor: null,
      effort: null,
      energyKind: null,
      area: null,
      source: "user",
      parentId: null,
    });
    expect(() => Schema.decodeSync(Task.jsonCreate)({ title: "" })).toThrow();
    expect(() => Schema.decodeSync(Task.jsonCreate)({ title: "x", effort: 6 })).toThrow();
  });

  it("jsonCreate drops server-owned fields sent by a client", () => {
    const created: Record<string, unknown> = Schema.decodeSync(Schema.toCodecJson(Task.jsonCreate))(
      {
        title: "x",
        id: "evil",
        createdAt: "2020-01-01T00:00:00Z",
        updatedAt: "2020-01-01T00:00:00Z",
        completedAt: "2020-01-01T00:00:00Z",
      },
    );
    expect("id" in created).toBe(false);
    expect("createdAt" in created).toBe(false);
    expect("updatedAt" in created).toBe(false);
    expect("completedAt" in created).toBe(false);
  });

  it("decodes a partial jsonUpdate payload", () => {
    const patch = Schema.decodeSync(Schema.toCodecJson(Task.jsonUpdate))({
      status: "done",
      due: "2026-10-06T09:00:00Z",
    });
    expect(patch.status).toBe("done");
    expect(
      patch.due === null || patch.due === undefined ? null : DateTime.formatIso(patch.due),
    ).toBe("2026-10-06T09:00:00.000Z");
    expect("title" in patch).toBe(false);
    expect(Schema.decodeSync(Task.jsonUpdate)({})).toEqual({});
    const sneaky: Record<string, unknown> = Schema.decodeSync(Schema.toCodecJson(Task.jsonUpdate))({
      completedAt: "2020-01-01T00:00:00Z",
    });
    expect("completedAt" in sneaky).toBe(false);
  });
});

describe("Thread", () => {
  const json = Schema.toCodecJson(Thread.json);

  it("round-trips through the JSON contract", async () => {
    const thread = new Thread(
      await Effect.runPromise(
        Thread.insert.makeEffect({ kind: "side", topic: "Trip planning", contextScope: "minimal" }),
      ),
    );
    expect(thread.status).toBe("active");
    expect(thread.lastMessageAt).toBeNull();
    const encoded = obj(Schema.encodeSync(json)(thread));
    expect(typeof encoded.id).toBe("string");
    expect(isIsoString(encoded.createdAt)).toBe(true);
    expect(encoded.lastMessageAt).toBeNull();
    const decoded = Schema.decodeUnknownSync(json)(wire(encoded));
    expect(decoded.kind).toBe("side");
    expect(decoded.contextScope).toBe("minimal");
    expect(millis(decoded.createdAt)).toBe(millis(thread.createdAt));
    expect(Schema.encodeSync(json)(decoded)).toEqual(encoded);
  });

  it("decodes a minimal jsonCreate payload with defaults, leaving contextScope to the service", () => {
    const created = Schema.decodeSync(Thread.jsonCreate)({ kind: "quest" });
    expect(created).toEqual({
      kind: "quest",
      parentThreadId: null,
      topic: null,
      status: "active",
    });
    expect("contextScope" in created).toBe(false);
    expect("lastMessageAt" in created).toBe(false);
    expect(Schema.decodeSync(Thread.jsonCreate)({ kind: "side", contextScope: "full" })).toEqual({
      kind: "side",
      parentThreadId: null,
      topic: null,
      contextScope: "full",
      status: "active",
    });
  });

  it("decodes a partial jsonUpdate payload without the immutable kind", () => {
    expect(Schema.decodeSync(Thread.jsonUpdate)({ status: "archived" })).toEqual({
      status: "archived",
    });
    const patch: Record<string, unknown> = Schema.decodeUnknownSync(Thread.jsonUpdate)({
      kind: "main",
      topic: "Renamed",
    });
    expect(patch).toEqual({ topic: "Renamed" });
  });
});

describe("Message", () => {
  const json = Schema.toCodecJson(Message.json);

  it("round-trips through the JSON contract", async () => {
    const message = new Message(
      await Effect.runPromise(
        Message.insert.makeEffect({
          threadId: threadId("thread-1"),
          role: "assistant",
          parts: [
            { type: "text", text: "Hello" },
            { type: "tool_call", id: "c1", name: "create_task", args: { title: "Buy milk" } },
            {
              type: "tool_result",
              toolCallId: "c1",
              name: "create_task",
              ok: true,
              result: { id: "t1" },
            },
            { type: "text", text: "Done." },
          ],
        }),
      ),
    );
    expect(message.runId).toBeNull();
    const encoded = obj(Schema.encodeSync(json)(message));
    expect(typeof encoded.id).toBe("string");
    expect(isIsoString(encoded.createdAt)).toBe(true);
    expect(encoded.parts).toHaveLength(4);
    const decoded = Schema.decodeUnknownSync(json)(wire(encoded));
    expect(decoded.parts).toEqual(message.parts);
    expect(decoded.threadId).toBe(message.threadId);
    expect(millis(decoded.createdAt)).toBe(millis(message.createdAt));
    expect(Message.text(decoded)).toBe("Hello\nDone.");
  });

  it("keeps parts as parsed JSON in the DB variants", async () => {
    const message = await Effect.runPromise(
      Message.insert.makeEffect({
        threadId: threadId("thread-1"),
        role: "user",
        parts: [{ type: "image", url: "https://example.com/a.png" }],
      }),
    );
    const encoded = Schema.encodeSync(Message.insert)(message);
    expect(Array.isArray(encoded.parts)).toBe(true);
    expect(encoded.createdAt).toBeInstanceOf(Date);
    const selected = Schema.decodeSync(Message)(encoded);
    expect(selected.parts).toEqual([{ type: "image", url: "https://example.com/a.png" }]);
  });

  it("decodes a minimal jsonCreate payload", () => {
    expect(
      Schema.decodeSync(Message.jsonCreate)({
        threadId: "th1",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
      }),
    ).toEqual({
      threadId: threadId("th1"),
      role: "user",
      parts: [{ type: "text", text: "hi" }],
      runId: null,
    });
  });

  it("jsonUpdate patches parts only; threadId and role are immutable", () => {
    expect(Schema.decodeSync(Message.jsonUpdate)({ parts: [] })).toEqual({ parts: [] });
    const patch: Record<string, unknown> = Schema.decodeUnknownSync(Message.jsonUpdate)({
      threadId: "other",
      role: "system",
      parts: [],
    });
    expect(patch).toEqual({ parts: [] });
  });
});

describe("Event", () => {
  const json = Schema.toCodecJson(Event.json);

  it("round-trips through the JSON contract", async () => {
    const occurredAt = DateTime.makeUnsafe("2026-10-04T12:00:00Z");
    const event = new Event(
      await Effect.runPromise(
        Event.insert.makeEffect({
          source: "gmail",
          type: "message.received",
          occurredAt,
          payload: { threadId: "abc", from: "x@y.z" },
          dedupeKey: "gmail:abc",
        }),
      ),
    );
    const encoded = obj(Schema.encodeSync(json)(event));
    expect(typeof encoded.id).toBe("string");
    expect(encoded.occurredAt).toBe("2026-10-04T12:00:00.000Z");
    expect(isIsoString(encoded.createdAt)).toBe(true);
    const decoded = Schema.decodeUnknownSync(json)(wire(encoded));
    expect(decoded.payload).toEqual(event.payload);
    expect(decoded.dedupeKey).toBe("gmail:abc");
    expect(millis(decoded.occurredAt)).toBe(millis(occurredAt));
    expect(Schema.encodeSync(json)(decoded)).toEqual(encoded);
  });

  it("stores occurredAt as a Date in the DB variants", async () => {
    const event = await Effect.runPromise(
      Event.insert.makeEffect({
        source: "system",
        type: "tick",
        occurredAt: DateTime.nowUnsafe(),
        payload: null,
      }),
    );
    const encoded = Schema.encodeSync(Event.insert)(event);
    expect(encoded.occurredAt).toBeInstanceOf(Date);
    expect(encoded.dedupeKey).toBeNull();
  });

  it("is append-only: jsonUpdate accepts an empty patch and ignores write-once fields", () => {
    expect(Schema.decodeSync(Event.jsonUpdate)({})).toEqual({});
    const patch: Record<string, unknown> = Schema.decodeUnknownSync(Event.jsonUpdate)({
      source: "x",
      type: "y",
      occurredAt: "2026-10-04T12:00:00Z",
      payload: 1,
    });
    expect(patch).toEqual({});
  });
});

describe("Nudge", () => {
  const json = Schema.toCodecJson(Nudge.json);

  it("round-trips through the JSON contract", async () => {
    const nudge = new Nudge(
      await Effect.runPromise(
        Nudge.insert.makeEffect({
          triggerEventId: eventId("evt-1"),
          body: "Dentist in 10 minutes. Leave now and you'll make it.",
          reasoning: "Due in 10 minutes",
          channel: "web_push",
          actions: [
            { id: "done", label: "Done", kind: "done" },
            { id: "snooze", label: "Snooze until tonight", kind: "snooze" },
          ],
          sentAt: DateTime.makeUnsafe("2026-10-04T12:00:00Z"),
        }),
      ),
    );
    expect(nudge.outcome).toBeNull();
    expect(nudge.messageId).toBeNull();
    const encoded = obj(Schema.encodeSync(json)(nudge));
    expect(typeof encoded.id).toBe("string");
    expect(encoded.body).toBe("Dentist in 10 minutes. Leave now and you'll make it.");
    expect(encoded.sentAt).toBe("2026-10-04T12:00:00.000Z");
    expect(encoded.outcomeAt).toBeNull();
    expect(isIsoString(encoded.createdAt)).toBe(true);
    const decoded = Schema.decodeUnknownSync(json)(wire(encoded));
    expect(decoded.body).toBe(nudge.body);
    expect(decoded.actions).toEqual(nudge.actions);
    expect(millis(decoded.sentAt)).toBe(millis(nudge.sentAt));
    expect(Schema.encodeSync(json)(decoded)).toEqual(encoded);
  });

  it("encodes DB variants with Date timestamps", async () => {
    const nudge = await Effect.runPromise(
      Nudge.insert.makeEffect({
        body: "b",
        reasoning: "r",
        channel: "inbox",
        actions: [{ id: "open", label: "Open", kind: "open" }],
        sentAt: DateTime.nowUnsafe(),
      }),
    );
    const encoded = Schema.encodeSync(Nudge.insert)(nudge);
    expect(encoded.sentAt).toBeInstanceOf(Date);
    expect(encoded.createdAt).toBeInstanceOf(Date);
    expect(encoded.outcomeAt).toBeNull();
    expect(Array.isArray(encoded.actions)).toBe(true);
  });

  it("requires at least one action", () => {
    const base = { body: "b", reasoning: "r", channel: "inbox" };
    expect(() => Schema.decodeUnknownSync(Nudge.jsonCreate)({ ...base, actions: [] })).toThrow();
    expect(
      Schema.decodeUnknownSync(Nudge.jsonCreate)({
        ...base,
        actions: [{ id: "done", label: "Done", kind: "done" }],
      }).actions,
    ).toHaveLength(1);
  });

  it("jsonUpdate records the outcome without re-sending write-once fields", () => {
    expect(Schema.decodeSync(Nudge.jsonUpdate)({ outcome: "done" })).toEqual({ outcome: "done" });
    const patch: Record<string, unknown> = Schema.decodeUnknownSync(Nudge.jsonUpdate)({
      outcome: "snoozed",
      body: "tampered",
      reasoning: "tampered",
      sentAt: "2026-10-04T12:00:00Z",
    });
    expect(patch).toEqual({ outcome: "snoozed" });
  });
});

describe("Capture", () => {
  const json = Schema.toCodecJson(Capture.json);

  it("round-trips through the JSON contract", async () => {
    const capture = new Capture(
      await Effect.runPromise(
        Capture.insert.makeEffect({ kind: "voice", payload: { url: "file://a.m4a" } }),
      ),
    );
    expect(capture.status).toBe("new");
    expect(capture.transcript).toBeNull();
    const encoded = obj(Schema.encodeSync(json)(capture));
    expect(typeof encoded.id).toBe("string");
    expect(isIsoString(encoded.createdAt)).toBe(true);
    expect(isIsoString(encoded.updatedAt)).toBe(true);
    const decoded = Schema.decodeUnknownSync(json)(wire(encoded));
    expect(decoded.kind).toBe("voice");
    expect(decoded.payload).toEqual({ url: "file://a.m4a" });
    expect(Schema.encodeSync(json)(decoded)).toEqual(encoded);
  });

  it("decodes a minimal jsonCreate payload with defaults", () => {
    expect(Schema.decodeSync(Capture.jsonCreate)({ kind: "text", payload: "call mom" })).toEqual({
      kind: "text",
      payload: "call mom",
      transcript: null,
      status: "new",
      routedTo: null,
    });
  });

  it("encodes DB variants with Date timestamps", async () => {
    const capture = await Effect.runPromise(
      Capture.insert.makeEffect({ kind: "image", payload: { url: "file://a.jpg" } }),
    );
    const encoded = Schema.encodeSync(Capture.insert)(capture);
    expect(encoded.createdAt).toBeInstanceOf(Date);
    expect(encoded.updatedAt).toBeInstanceOf(Date);
    expect(encoded.payload).toEqual({ url: "file://a.jpg" });
  });

  it("jsonUpdate routes a capture without re-sending kind/payload", () => {
    expect(Schema.decodeSync(Capture.jsonUpdate)({ status: "routed", routedTo: "task:1" })).toEqual(
      { status: "routed", routedTo: "task:1" },
    );
    const patch: Record<string, unknown> = Schema.decodeUnknownSync(Capture.jsonUpdate)({
      kind: "voice",
      payload: "x",
      transcript: "hello",
    });
    expect(patch).toEqual({ transcript: "hello" });
  });
});

describe("ids", () => {
  it("brands are plain strings on the wire", () => {
    expect(Schema.encodeSync(TaskId)(taskId("t1"))).toBe("t1");
    expect(Schema.decodeSync(TaskId)("t1")).toBe(taskId("t1"));
    expect(() => Schema.decodeUnknownSync(TaskId)(1)).toThrow();
  });
});
