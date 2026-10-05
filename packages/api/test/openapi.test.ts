import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openApiSpec, renderOpenApiJson } from "../src/openapi.ts";
import {
  chatStreamEventComponents,
  findDiscriminator,
  jsonEqual,
  normalizeNullable,
} from "../src/openapi-transform.ts";

const packageDir = fileURLToPath(new URL("..", import.meta.url));

describe("OpenAPI", () => {
  const spec = openApiSpec();
  const component = (name: string): Record<string, unknown> => {
    const schema = spec.components.schemas[name];
    expect(schema).toBeDefined();
    return (schema ?? {}) as Record<string, unknown>;
  };

  it("carries the API metadata", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Bloom API");
    expect(spec.info.version).toBe("0.1.0");
  });

  it("puts every path under /api and none under /api/auth", () => {
    const paths = Object.keys(spec.paths);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith("/api/")).toBe(true);
      expect(path.startsWith("/api/auth")).toBe(false);
      expect(path.endsWith("/")).toBe(false);
    }
  });

  it("includes the expected paths and methods", () => {
    expect(spec.paths["/api/health"]?.get).toBeDefined();
    expect(spec.paths["/api/me"]?.get).toBeDefined();
    expect(spec.paths["/api/tasks"]?.get).toBeDefined();
    expect(spec.paths["/api/tasks"]?.post).toBeDefined();
    expect(spec.paths["/api/tasks/{id}"]?.get).toBeDefined();
    expect(spec.paths["/api/tasks/{id}"]?.patch).toBeDefined();
    expect(spec.paths["/api/tasks/{id}"]?.delete).toBeDefined();
    expect(spec.paths["/api/tasks/{id}/complete"]?.post).toBeDefined();
    expect(spec.paths["/api/threads"]?.get).toBeDefined();
    expect(spec.paths["/api/threads"]?.post).toBeDefined();
    expect(spec.paths["/api/threads/main"]?.get).toBeDefined();
    expect(spec.paths["/api/threads/{id}"]?.get).toBeDefined();
    expect(spec.paths["/api/threads/{id}/messages"]?.get).toBeDefined();
    expect(spec.paths["/api/threads/{id}/messages"]?.post).toBeDefined();
    expect(spec.paths["/api/captures"]?.get).toBeDefined();
    expect(spec.paths["/api/captures"]?.post).toBeDefined();
    expect(spec.paths["/api/captures/{id}"]?.get).toBeDefined();
    expect(spec.paths["/api/captures/{id}"]?.patch).toBeDefined();
    expect(spec.paths["/api/events"]?.post).toBeDefined();
  });

  it("describes the ingest result as a union discriminated on _tag", () => {
    expect(component("IngestResult")["discriminator"]).toEqual({
      propertyName: "_tag",
      mapping: {
        Inserted: "#/components/schemas/EventInserted",
        Duplicate: "#/components/schemas/EventDuplicate",
      },
    });
  });

  it("keeps create payloads minimal: only title / kind are required, and kind excludes main", () => {
    const task = spec.paths["/api/tasks"]?.post?.requestBody?.content["application/json"]?.schema;
    expect(task).toEqual({ $ref: "#/components/schemas/TaskCreate" });
    expect(component("TaskCreate")["required"]).toEqual(["title"]);
    const thread =
      spec.paths["/api/threads"]?.post?.requestBody?.content["application/json"]?.schema;
    expect(thread).toEqual({ $ref: "#/components/schemas/ThreadCreate" });
    expect(component("ThreadCreate")).toMatchObject({
      required: ["kind"],
      properties: { kind: { enum: ["side", "quest"] } },
    });
  });

  it("names the wire types as components, so generated clients get readable types", () => {
    const names = Object.keys(spec.components.schemas);
    for (const name of [
      "Task",
      "TaskCreate",
      "TaskUpdate",
      "TaskStatus",
      "Thread",
      "ThreadCreate",
      "Message",
      "MessagePart",
      "UiComponent",
      "ChatStreamEvent",
      "AuthUser",
      "HealthStatus",
      "SendMessage",
    ]) {
      expect(names).toContain(name);
    }
    expect(
      spec.paths["/api/tasks"]?.get?.responses[200]?.content?.["application/json"]?.schema,
    ).toEqual({ type: "array", items: { $ref: "#/components/schemas/Task" } });
  });

  it("turns tagged unions into oneOf with a discriminator mapping", () => {
    expect(component("MessagePart")["discriminator"]).toEqual({
      propertyName: "type",
      mapping: {
        text: "#/components/schemas/TextPart",
        image: "#/components/schemas/ImagePart",
        tool_call: "#/components/schemas/ToolCallPart",
        tool_result: "#/components/schemas/ToolResultPart",
        ui_component: "#/components/schemas/UiComponentPart",
      },
    });
    expect(component("UiComponent")).toMatchObject({ discriminator: { propertyName: "kind" } });
    const events = component("ChatStreamEvent");
    expect(events["anyOf"]).toBeUndefined();
    expect(events["oneOf"]).toHaveLength(8);
    expect(Object.keys((events["discriminator"] as { mapping: object }).mapping)).toEqual([
      "message_start",
      "text_delta",
      "tool_call",
      "tool_result",
      "ui_component",
      "tasks_changed",
      "message_end",
      "error",
    ]);
  });

  it("leaves unions without a shared literal property alone", () => {
    const schemas = {
      A: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
      B: { type: "object", properties: { b: { type: "string" } }, required: ["b"] },
    };
    const refs = [{ $ref: "#/components/schemas/A" }, { $ref: "#/components/schemas/B" }];
    expect(findDiscriminator(schemas, refs)).toBeUndefined();
    expect(findDiscriminator(schemas, [refs[0], { type: "null" }])).toBeUndefined();
  });

  it("documents the SSE data as ChatStreamEvent JSON", () => {
    const data = spec.paths["/api/threads/{id}/messages"]?.post?.responses[200]?.content?.[
      "text/event-stream"
    ]?.schema as { properties: { data: { $ref: string } } };
    const target = data.properties.data.$ref.replace("#/components/schemas/", "");
    expect(component(target)).toMatchObject({
      type: "string",
      contentMediaType: "application/json",
      contentSchema: { $ref: "#/components/schemas/ChatStreamEvent" },
    });
  });

  it("carries the stream event schemas exactly as the endpoints describe them", () => {
    // Shared definitions (Message, MessagePart, ...) come from two generators:
    // the API document and the standalone ChatStreamEvent document. They must agree.
    const stream = normalizeNullable({
      components: { schemas: structuredClone(chatStreamEventComponents().definitions) },
    }) as { components: { schemas: Record<string, Record<string, unknown>> } };
    for (const [name, definition] of Object.entries(stream.components.schemas)) {
      const inSpec = { ...component(name) };
      delete inSpec["discriminator"];
      const expected: Record<string, unknown> = { ...definition };
      if (Array.isArray(expected["anyOf"]) && Array.isArray(inSpec["oneOf"])) {
        expected["oneOf"] = expected["anyOf"];
        delete expected["anyOf"];
      }
      expect(jsonEqual(inSpec, expected)).toBe(true);
    }
  });

  it("writes nullable values as type arrays, never as a bare null schema", () => {
    expect(JSON.stringify(spec)).not.toContain('{"type":"null"}');
    expect(component("Task")["properties"]).toMatchObject({
      notes: { type: ["string", "null"] },
      effort: { type: ["integer", "null"], minimum: 1, maximum: 5 },
      energyKind: {
        type: ["string", "null"],
        enum: ["focus", "admin", "physical", "social", "rest", null],
      },
    });
    expect(spec.paths["/api/tasks"]?.get?.parameters?.[0]).toMatchObject({
      name: "status",
      schema: { type: ["array", "null"], items: { $ref: "#/components/schemas/TaskStatus" } },
    });
  });

  it("normalizeNullable keeps nullable references to named objects as they are", () => {
    const nullableObject = { anyOf: [{ $ref: "#/components/schemas/Obj" }, { type: "null" }] };
    const document = {
      components: {
        schemas: {
          Obj: { type: "object", properties: {} },
          Kind: { type: "string", enum: ["a", "b"] },
          Holder: {
            type: "object",
            properties: {
              obj: nullableObject,
              kind: { anyOf: [{ type: "null" }, { $ref: "#/components/schemas/Kind" }] },
              many: { anyOf: [{ type: "string" }, { type: "integer" }] },
            },
          },
        },
      },
    };
    const normalized = normalizeNullable(structuredClone(document)) as {
      components: { schemas: { Holder: { properties: Record<string, unknown> } } };
    };
    const holder = normalized.components.schemas.Holder.properties;
    expect(holder.obj).toEqual(nullableObject);
    expect(holder.kind).toEqual({ type: ["string", "null"], enum: ["a", "b", null] });
    expect(holder.many).toEqual({ anyOf: [{ type: "string" }, { type: "integer" }] });
  });

  it("the committed openapi.json is up to date (run `bun run openapi`)", () => {
    expect(readFileSync(join(packageDir, "openapi.json"), "utf8")).toBe(renderOpenApiJson());
  });

  it("describes the chat stream as text/event-stream", () => {
    const content = spec.paths["/api/threads/{id}/messages"]?.post?.responses[200]?.content;
    expect(content).toBeDefined();
    expect(Object.keys(content ?? {})).toEqual(["text/event-stream"]);
  });

  it("documents 404 and 401 responses on protected endpoints", () => {
    const responses = spec.paths["/api/tasks/{id}"]?.get?.responses ?? {};
    expect(Object.keys(responses)).toContain("404");
    expect(Object.keys(responses)).toContain("401");
    expect(Object.keys(spec.paths["/api/health"]?.get?.responses ?? {})).not.toContain("401");
    expect(Object.keys(spec.paths["/api/tasks/{id}"]?.delete?.responses ?? {})).toContain("204");
  });

  it("renders pretty JSON with a trailing newline", () => {
    const json = renderOpenApiJson();
    expect(json.endsWith("}\n")).toBe(true);
    expect(json.includes('\n  "openapi"')).toBe(true);
    expect(JSON.parse(json)).toEqual(spec);
  });

  it("emit-openapi writes the document and exits 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "bloom-openapi-"));
    const target = join(dir, "openapi.json");
    try {
      const result = Bun.spawnSync(["bun", "run", "scripts/emit-openapi.ts", target], {
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
      const written = JSON.parse(readFileSync(target, "utf8")) as typeof spec;
      expect(Object.keys(written.paths)).toContain("/api/health");
      expect(Object.keys(written.paths)).toContain("/api/tasks/{id}");
      expect(Object.keys(written.paths)).toContain("/api/threads/{id}/messages");
      expect(readFileSync(target, "utf8").endsWith("\n")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
