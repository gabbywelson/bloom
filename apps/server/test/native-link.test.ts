import { describe, expect, it } from "bun:test";
import { NATIVE_SIGN_IN_URL, parseAuthLinkArgs, toNativeLink } from "../src/cli/native-link.ts";

const link =
  "http://localhost:5173/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fpasskeys";

const wrapped = (native: string | undefined): URL => {
  expect(native).toBeDefined();
  return new URL(native ?? "");
};

describe("toNativeLink", () => {
  it("wraps the verify URL in a bloom:// sign-in link", () => {
    const native = wrapped(toNativeLink(link));
    expect(`${native.protocol}//${native.host}${native.pathname}`).toBe(NATIVE_SIGN_IN_URL);
    expect(native.searchParams.get("link")).toBe(link);
  });

  it("rewrites the origin when the phone reaches the server under another name", () => {
    const inner = new URL(
      wrapped(toNativeLink(link, { server: "https://mac.tail1234.ts.net" })).searchParams.get(
        "link",
      ) ?? "",
    );
    expect(inner.origin).toBe("https://mac.tail1234.ts.net");
    expect(inner.pathname).toBe("/api/auth/magic-link/verify");
    expect(inner.searchParams.get("token")).toBe("abc123");
  });

  it("refuses anything that is not an http(s) URL", () => {
    expect(toNativeLink("not a url")).toBeUndefined();
    expect(toNativeLink(link, { server: "localhost:3000" })).toBeUndefined();
    expect(toNativeLink(link, { server: "ftp://example.com" })).toBeUndefined();
  });
});

describe("parseAuthLinkArgs", () => {
  it("defaults to the web link", () => {
    expect(parseAuthLinkArgs([])).toEqual({ ios: false, server: undefined });
  });

  it("reads --ios and --server (which implies --ios)", () => {
    expect(parseAuthLinkArgs(["--ios"])).toEqual({ ios: true, server: undefined });
    expect(parseAuthLinkArgs(["--server", "http://localhost:3000"])).toEqual({
      ios: true,
      server: "http://localhost:3000",
    });
  });
});
