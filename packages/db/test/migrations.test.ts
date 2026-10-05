import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { betterAuthStatements } from "../migrations/0001_better_auth.ts";
import { orderedTables } from "../migrations/0003_ordering_repair.ts";
import { migrations } from "../migrations/index.ts";
import { ensureTestDatabase, makeTestRuntime } from "./helpers.ts";

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

describe("migrated schema (bloom_test)", () => {
  it("every Bloom table has seq and its (created_at, seq) index after migrating", async () => {
    await Effect.runPromise(ensureTestDatabase);
    const runtime = makeTestRuntime();
    try {
      const { columns, indexes } = await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const columns = yield* sql<{ tableName: string }>`
            SELECT table_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'seq'`;
          const indexes = yield* sql<{ indexname: string }>`
            SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
          return { columns, indexes };
        }),
      );
      const withSeq = new Set(columns.map((row) => row.tableName));
      for (const table of orderedTables) {
        expect(withSeq.has(table)).toBe(true);
      }
      const names = new Set(indexes.map((row) => row.indexname));
      expect(names.has("captures_created_at_seq_idx")).toBe(true);
      expect(names.has("nudges_created_at_seq_idx")).toBe(true);
      expect(names.has("nudges_created_at_id_idx")).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });
});
