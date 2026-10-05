/**
 * The done-condition, end to end, against a running stack (see README.md):
 *
 *   magic link → register a passkey → sign out → sign in with the passkey →
 *   ask Bloom to add a task → the task shows up → ask what's on the list →
 *   the request is one trace in Jaeger (HTTP span + agent.run).
 *
 * WebAuthn is driven by a CDP virtual authenticator, so no OS prompt appears.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, type CDPSession, expect, type Page, test } from "@playwright/test";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const JAEGER_URL = process.env.JAEGER_URL ?? "http://localhost:16686";
const JAEGER_SERVICE = process.env.JAEGER_SERVICE ?? "bloom-server";
/**
 * Model calls can take a while; the UI must settle within this, counted from
 * the moment the message is sent (one budget shared by all waits in `ask`).
 * playwright.config.ts derives the test timeout from this number.
 */
const REPLY_TIMEOUT = 90_000;
/** How long the exporter + collector may take to land the spans in Jaeger. */
const TRACE_TIMEOUT = 60_000;
/** Nouns for the per-run unique task; the suffix makes the title unmistakable. */
const PLANTS = ["ferns", "orchids", "basil", "succulents", "tomatoes"];

/** Runs `bun run auth:link` in the repo root and returns the printed sign-in URL. */
const requestMagicLink = (): string => {
  const stdout = execFileSync("bun", ["run", "auth:link"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
  const urls = stdout.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const link = urls.find((url) => /magic-link|token=/.test(url)) ?? urls[0];
  if (link === undefined) {
    throw new Error("bun run auth:link printed no URL");
  }
  return link;
};

/**
 * The link must be opened on the web origin so the session cookie and the
 * passkey bind to it (ADR 0004). `/api/*` is proxied there, so swapping the
 * origin keeps the link valid.
 */
const onWebOrigin = (link: string, webOrigin: string): string => {
  const url = new URL(link);
  const origin = new URL(webOrigin);
  url.protocol = origin.protocol;
  url.host = origin.host;
  return url.toString();
};

const addVirtualAuthenticator = async (cdp: CDPSession): Promise<void> => {
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
};

/** Sends a message and waits until Bloom's reply has fully arrived; returns the new assistant bubble. */
const ask = async (page: Page, text: string) => {
  const assistant = page.getByTestId("message-assistant");
  const before = await assistant.count();

  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
  const deadline = Date.now() + REPLY_TIMEOUT;
  const remaining = () => Math.max(1_000, deadline - Date.now());

  await expect(page.getByTestId("message-user").last()).toContainText(text);
  // The opening flower shows while the reply streams; a very fast reply may
  // already have hidden it, so only its disappearance is asserted below. Both
  // waits share the one REPLY_TIMEOUT budget started when the message went out.
  await expect.poll(() => assistant.count(), { timeout: remaining() }).toBeGreaterThan(before);
  await expect(page.getByTestId("bloom-thinking")).toBeHidden({ timeout: remaining() });

  return assistant.last();
};

/*
 * Jaeger 2.x serves only the v3 query API (`/api/v3/traces`, OTLP JSON); the
 * legacy `/api/traces` endpoint answers 404. The start-time bounds are
 * mandatory, which is also what scopes the check to this run.
 */
interface OtlpAttribute {
  readonly key: string;
  readonly value: { readonly stringValue?: string; readonly intValue?: string };
}
interface OtlpSpan {
  readonly traceId: string;
  readonly name: string;
  readonly attributes?: ReadonlyArray<OtlpAttribute>;
}
interface OtlpTracesResponse {
  readonly result?: {
    readonly resourceSpans?: ReadonlyArray<{
      readonly scopeSpans?: ReadonlyArray<{ readonly spans?: ReadonlyArray<OtlpSpan> }>;
    }>;
  };
}

const attribute = (span: OtlpSpan, key: string): string | undefined =>
  span.attributes?.find((entry) => entry.key === key)?.value.stringValue;

const isSendMessageHttpSpan = (span: OtlpSpan): boolean =>
  span.name.startsWith("http.server") &&
  attribute(span, "http.request.method") === "POST" &&
  /\/api\/threads\/[^/]+\/messages$/.test(attribute(span, "url.path") ?? "");

const isAgentRunSpan = (span: OtlpSpan): boolean => span.name === "agent.run";

/**
 * The ids of traces started after `since` that contain both the POST /messages
 * HTTP span and the agent.run span. A non-OK answer other than Jaeger's
 * 404-for-empty throws, so an endpoint mismatch fails with the status instead
 * of an empty list.
 */
const completeTraceIds = async (
  request: APIRequestContext,
  since: Date,
): Promise<ReadonlyArray<string>> => {
  const response = await request.get(`${JAEGER_URL}/api/v3/traces`, {
    params: {
      "query.service_name": JAEGER_SERVICE,
      "query.start_time_min": since.toISOString(),
      "query.start_time_max": new Date().toISOString(),
      "query.search_depth": 20,
    },
  });
  // An empty window is reported as 404 `{"error":{"message":"No traces found"}}`,
  // which is simply "not yet" while polling. Anything else is a real mismatch
  // (wrong URL, wrong Jaeger version) and fails the step at once.
  if (response.status() === 404) return [];
  if (!response.ok()) {
    throw new Error(
      `Jaeger ${response.url()} answered ${response.status()}: ${await response.text()}`,
    );
  }
  const body = (await response.json()) as OtlpTracesResponse;
  const byTrace = new Map<string, OtlpSpan[]>();
  for (const resource of body.result?.resourceSpans ?? []) {
    for (const scope of resource.scopeSpans ?? []) {
      for (const span of scope.spans ?? []) {
        const spans = byTrace.get(span.traceId) ?? [];
        spans.push(span);
        byTrace.set(span.traceId, spans);
      }
    }
  }
  return [...byTrace.entries()]
    .filter(([, spans]) => spans.some(isSendMessageHttpSpan) && spans.some(isAgentRunSpan))
    .map(([traceId]) => traceId);
};

test.describe("Bloom", () => {
  let magicLink: string;

  test.beforeAll(() => {
    magicLink = requestMagicLink();
  });

  test("passkey bootstrap, chat round-trip, task creation, and one trace per turn", async ({
    page,
    context,
    baseURL,
    request,
  }) => {
    const webOrigin = baseURL ?? "http://localhost:5173";

    await test.step("virtual authenticator", async () => {
      await addVirtualAuthenticator(await context.newCDPSession(page));
    });

    await test.step("magic link lands on /passkeys", async () => {
      await page.goto(onWebOrigin(magicLink, webOrigin));
      await expect(page).toHaveURL(/\/passkeys$/);
    });

    await test.step("register a passkey", async () => {
      // Earlier runs (and manual bootstraps) leave their passkeys in the
      // database, so assert on growth rather than on an exact count.
      const items = page.getByTestId("passkey-item");
      await expect(page.getByTestId("passkey-add")).toBeEnabled();
      await expect(page.getByText("Loading", { exact: true })).toBeHidden();
      const before = await items.count();
      await page.getByTestId("passkey-add").click();
      await expect(items).toHaveCount(before + 1);
    });

    await test.step("sign out", async () => {
      await page.getByTestId("sign-out").click();
      await expect(page).toHaveURL(/\/login$/);
    });

    await test.step("sign in with the passkey", async () => {
      await page.getByTestId("login-passkey").click();
      await expect(page).toHaveURL(`${webOrigin.replace(/\/$/, "")}/`);
      await expect(page.getByTestId("composer-input")).toBeVisible();
    });

    // Only traces that start from here on count as this run's.
    const chatStartedAt = new Date();

    // A fresh noun per run so a task left by an earlier run cannot satisfy the check.
    const plant = `${PLANTS[Math.floor(Math.random() * PLANTS.length)]}-${Date.now().toString(36)}`;

    await test.step("ask Bloom to add a task", async () => {
      await ask(page, `Please add a task to water the ${plant} tomorrow`);
      await expect(
        page
          .getByTestId("task-list")
          .getByTestId("task-item")
          .filter({ hasText: new RegExp(`water the ${plant}`, "i") }),
      ).not.toHaveCount(0);
    });

    await test.step("ask what's on the list", async () => {
      const reply = await ask(page, "What's on my list?");
      await expect(reply).toContainText(new RegExp(plant, "i"));
    });

    await test.step("each turn is one trace in Jaeger", async () => {
      await expect
        .poll(() => completeTraceIds(request, chatStartedAt), {
          timeout: TRACE_TIMEOUT,
          intervals: [1_000, 2_000, 5_000],
        })
        .not.toHaveLength(0);
    });
  });
});
