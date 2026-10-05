import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the Bloom web app (see e2e/README.md).
 *
 * There is deliberately no `webServer` block: the suite drives a running
 * stack (Postgres + OTel collector + Jaeger, the Bun server, the Vite dev
 * server) that the operator or orchestrator starts beforehand.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // The single test waits up to REPLY_TIMEOUT (90 s, shared across the two
  // waits inside `ask`) for each of its two turns, up to 60 s for Jaeger, and
  // a few seconds of auth steps: 2 x 90 + 60 = 240 s of allowed waiting, plus
  // a 60 s margin so a slow-but-successful run fails on a named step, if at all.
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
