/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { traceUrl } from "./format";

describe("traceUrl", () => {
  const id = "4bf92f3577b34da6a3ce929d0e0e4736";

  it("appends a trace id to the Jaeger trace view", () => {
    expect(traceUrl(id, "http://localhost:16686/trace/")).toBe(
      `http://localhost:16686/trace/${id}`,
    );
  });

  it("hides the link when no base is configured or the id is not a trace id", () => {
    expect(traceUrl(id, "")).toBeNull();
    expect(traceUrl("not-a-trace", "http://localhost:16686/trace/")).toBeNull();
    expect(traceUrl("javascript:alert(1)", "http://localhost:16686/trace/")).toBeNull();
  });
});
