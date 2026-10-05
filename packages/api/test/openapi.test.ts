import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openApiSpec, renderOpenApiJson } from "../src/openapi.ts";

const packageDir = fileURLToPath(new URL("..", import.meta.url));

describe("OpenAPI", () => {
  const spec = openApiSpec();

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
  });

  it("keeps create payloads minimal: only title / kind are required, and kind excludes main", () => {
    const task = spec.paths["/api/tasks"]?.post?.requestBody?.content["application/json"]?.schema;
    expect(task?.required).toEqual(["title"]);
    const thread =
      spec.paths["/api/threads"]?.post?.requestBody?.content["application/json"]?.schema;
    expect(thread).toMatchObject({
      required: ["kind"],
      properties: { kind: { enum: ["side", "quest"] } },
    });
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
