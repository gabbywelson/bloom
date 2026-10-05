/**
 * Recorded chat streams, shared with the iOS client.
 *
 * Each fixture in `test/fixtures/chat-stream/` is the exact body of a
 * `POST /api/threads/:id/messages` response for one scripted run, rendered by
 * the real HttpApi SSE encoder. This test proves the files match what the
 * server emits; `apps/ios/BloomTests` decodes the same files, so the two
 * sides cannot drift apart silently. Regenerate with
 * `UPDATE_FIXTURES=1 bun test packages/api/test/sse-fixtures.test.ts`.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ChatStreamEvent, MessageId, TaskId, ThreadId } from "@bloom/domain";
import { DateTime, Effect, Layer, Schema, Stream } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { BloomApi } from "../src/api.ts";
import { AuthorizationAllow, HandlersWithoutMessages, MemoryServices } from "./handlers.ts";

const fixtureDir = fileURLToPath(new URL("./fixtures/chat-stream/", import.meta.url));

const threadId = Schema.decodeSync(ThreadId)("019a0000-0000-7000-8000-0000000000a1");
const messageId = Schema.decodeSync(MessageId)("019a0000-0000-7000-8000-0000000000b2");
const taskId = Schema.decodeSync(TaskId)("019a0000-0000-7000-8000-0000000000c3");
const createdAt = DateTime.makeUnsafe("2026-10-05T07:30:00.000Z");

const start: ChatStreamEvent = { type: "message_start", messageId, threadId };
const delta = (text: string): ChatStreamEvent => ({ type: "text_delta", messageId, delta: text });

/** One scripted run per fixture, following the ADR 0013 sequence. */
const scenarios: Record<string, ReadonlyArray<ChatStreamEvent>> = {
  "plain-reply": [
    start,
    delta("Morning. "),
    delta("Nothing urgent today."),
    {
      type: "message_end",
      message: {
        id: messageId,
        threadId,
        role: "assistant",
        parts: [{ type: "text", text: "Morning. Nothing urgent today." }],
        runId: null,
        traceId: null,
        createdAt,
      },
    },
  ],
  "tool-round": [
    start,
    {
      type: "tool_call",
      messageId,
      toolCallId: "toolu_01",
      name: "create_task",
      args: { title: "Water the ferns", effort: 1 },
    },
    { type: "tool_result", messageId, toolCallId: "toolu_01", name: "create_task", ok: true },
    { type: "tasks_changed" },
    delta("Added "),
    delta("“Water the ferns”."),
    {
      type: "message_end",
      message: {
        id: messageId,
        threadId,
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: "toolu_01",
            name: "create_task",
            args: { title: "Water the ferns", effort: 1 },
          },
          {
            type: "tool_result",
            toolCallId: "toolu_01",
            name: "create_task",
            ok: true,
            result: { id: taskId, title: "Water the ferns", status: "inbox" },
          },
          { type: "text", text: "Added “Water the ferns”." },
          {
            type: "ui_component",
            component: {
              kind: "task_card",
              taskId,
              title: "Water the ferns",
              status: "inbox",
              due: null,
            },
          },
        ],
        runId: null,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        createdAt,
      },
    },
  ],
  "model-error": [
    start,
    delta("Let me"),
    {
      type: "error",
      message: "I couldn't reach my thinking right now. Nothing was lost; try again in a moment.",
    },
  ],
};

/** `messages.send` answers with the scenario named by the user's text. */
const ScriptedMessages = HttpApiBuilder.group(BloomApi, "messages", (handlers) =>
  handlers.handle("send", ({ payload }) =>
    Effect.succeed(Stream.fromIterable(scenarios[payload.text] ?? [])),
  ),
);

const AppLayer = HttpApiBuilder.layer(BloomApi).pipe(
  Layer.provide(
    Layer.mergeAll(HandlersWithoutMessages, ScriptedMessages).pipe(
      Layer.provideMerge(AuthorizationAllow),
    ),
  ),
  Layer.provide(MemoryServices),
  Layer.provide(HttpServer.layerServices),
);

const render = async (
  scenario: string,
): Promise<{ status: number; type: string; body: string }> => {
  const { handler, dispose } = HttpRouter.toWebHandler(AppLayer, { disableLogger: true });
  try {
    const response = await handler(
      new Request(`http://bloom.test/api/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: scenario }),
      }),
    );
    return {
      status: response.status,
      type: response.headers.get("content-type") ?? "",
      body: await response.text(),
    };
  } finally {
    await dispose();
  }
};

describe("recorded chat streams (shared with apps/ios)", () => {
  for (const scenario of Object.keys(scenarios)) {
    it(`${scenario}.sse is what the server sends`, async () => {
      const { status, type, body } = await render(scenario);
      expect(status).toBe(200);
      expect(type).toContain("text/event-stream");
      const path = join(fixtureDir, `${scenario}.sse`);
      if (process.env["UPDATE_FIXTURES"] === "1") {
        writeFileSync(path, body);
      }
      expect(body).toBe(readFileSync(path, "utf8"));
    });
  }

  it("frames every event as one data line followed by a blank line", async () => {
    const { body } = await render("tool-round");
    const frames = body.split("\n\n").filter((frame) => frame.length > 0);
    expect(frames).toHaveLength(scenarios["tool-round"]?.length ?? 0);
    for (const frame of frames) {
      expect(frame.startsWith("data: ")).toBe(true);
      expect(frame.includes("\n")).toBe(false);
    }
  });
});
