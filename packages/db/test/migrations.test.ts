import { describe, expect, it } from "bun:test";
import { betterAuthStatements } from "../migrations/0001_better_auth.ts";
import { migrations } from "../migrations/index.ts";

describe("migrations record", () => {
  it("keys parse as strictly increasing <id>_<name>", () => {
    const ids = Object.keys(migrations).map((key) => {
      const match = key.match(/^(\d+)_(.+)$/);
      if (match === null) {
        throw new Error(`bad migration key ${key}`);
      }
      return Number(match[1]);
    });
    expect(ids.length).toBeGreaterThan(0);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1] ?? -1);
    }
  });

  it("keeps the Better Auth DDL as one statement per entry", () => {
    expect(betterAuthStatements).toHaveLength(10);
    for (const statement of betterAuthStatements) {
      expect(statement.trim().length).toBeGreaterThan(0);
      expect(statement.includes(";")).toBe(false);
    }
    expect(betterAuthStatements.filter((s) => s.startsWith("create table"))).toHaveLength(5);
    expect(betterAuthStatements.filter((s) => s.startsWith("create index"))).toHaveLength(5);
  });
});
