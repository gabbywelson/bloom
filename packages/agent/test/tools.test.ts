import { describe, expect, it } from "bun:test";
import { TaskService } from "@bloom/domain";
import { DateTime, Effect, Layer, Stream } from "effect";
import type { Tool } from "effect/ai";
import {
  BloomToolkit,
  BloomToolkitLive,
  type BloomTools,
  bloomToolNames,
  openStatuses,
} from "../src/index.ts";

const layer = BloomToolkitLive.pipe(Layer.provideMerge(TaskService.layerMemory));

/** Runs a tool the way the model layer does: encoded params in, final result out. */
const handle = <Name extends keyof BloomTools>(
  name: Name,
  params: Tool.ParametersEncoded<BloomTools[Name]>,
) =>
  Effect.gen(function* () {
    const toolkit = yield* BloomToolkit;
    const results = yield* toolkit
      .handle(name, params, "call-1")
      .pipe(Effect.flatMap(Stream.runCollect));
    const final = results.find((result) => !result.preliminary);
    if (final === undefined) {
      throw new Error("no final tool result");
    }
    return final;
  });

describe("BloomToolkit", () => {
  it("exposes create_task and list_tasks", () => {
    expect(bloomToolNames).toEqual(["create_task", "list_tasks"]);
  });

  it("create_task creates a task with source agent and returns it as JSON", async () => {
    const { result, encoded, tasks } = await Effect.runPromise(
      Effect.gen(function* () {
        const created = yield* handle("create_task", {
          title: "Call the dentist",
          due: "2026-10-06T09:00:00Z",
          effort: 2,
          energyKind: "social",
        });
        const service = yield* TaskService;
        const tasks = yield* service.list();
        return { result: created.result, encoded: created.encodedResult, tasks };
      }).pipe(Effect.provide(layer)),
    );
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    if (task === undefined) {
      throw new Error("task missing");
    }
    expect(task.title).toBe("Call the dentist");
    expect(task.source).toBe("agent");
    expect(task.status).toBe("inbox");
    expect(task.effort).toBe(2);
    expect(task.energyKind).toBe("social");
    expect(task.due === null ? null : DateTime.formatIso(task.due)).toBe(
      "2026-10-06T09:00:00.000Z",
    );
    expect(result).toMatchObject({ id: task.id, title: "Call the dentist", source: "agent" });
    expect(encoded).toMatchObject({
      id: task.id,
      title: "Call the dentist",
      due: "2026-10-06T09:00:00.000Z",
    });
  });

  it("create_task rejects a malformed due date as a parameter validation error", async () => {
    const exit = await Effect.runPromiseExit(
      handle("create_task", { title: "Water plants", due: "tomorrow-ish" }).pipe(
        Effect.provide(layer),
      ),
    );
    expect(exit._tag).toBe("Failure");
    expect(String(exit)).toContain("ToolParameterValidationError");
  });

  it("list_tasks defaults to open tasks and honours a status filter", async () => {
    const { open, done } = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* TaskService;
        yield* handle("create_task", { title: "A" });
        const b = yield* service.create(
          {
            title: "B",
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
        yield* service.complete(b.id, "user");
        const open = yield* handle("list_tasks", {});
        const done = yield* handle("list_tasks", { status: ["done"] });
        return { open: open.result, done: done.result };
      }).pipe(Effect.provide(layer)),
    );
    expect(openStatuses).toEqual(["inbox", "next", "scheduled", "waiting"]);
    expect(Array.isArray(open) && open.map((task) => task.title)).toEqual(["A"]);
    expect(Array.isArray(done) && done.map((task) => task.title)).toEqual(["B"]);
  });
});
