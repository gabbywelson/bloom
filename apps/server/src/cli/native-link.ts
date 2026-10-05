/**
 * Turns the magic link Better Auth issues into the deep link the iOS app
 * opens (ADR 0018): `bloom://sign-in?link=<the verify URL>`.
 *
 * The app requests the verify URL itself, without following the redirect,
 * and keeps the `set-auth-token` response header as its bearer token. The
 * link's origin doubles as the server the app talks to, so `server`
 * rewrites it when the phone reaches the server under another name (the
 * simulator uses `http://localhost:3000`; a phone uses the Tailscale name).
 */
export const NATIVE_SIGN_IN_URL = "bloom://sign-in";

export interface NativeLinkOptions {
  /** Origin the app should use instead of the link's own, e.g. `http://mac.tailnet.ts.net:3000`. */
  readonly server?: string | undefined;
}

/** `undefined` when `link` or `server` is not an absolute http(s) URL. */
export const toNativeLink = (link: string, options: NativeLinkOptions = {}): string | undefined => {
  if (!URL.canParse(link)) return undefined;
  let verify = new URL(link);
  if (options.server !== undefined) {
    if (!URL.canParse(options.server)) return undefined;
    const server = new URL(options.server);
    if (server.protocol !== "http:" && server.protocol !== "https:") return undefined;
    // Rebuilt rather than assigning `host`: that setter keeps the old port
    // when the new host has none.
    verify = new URL(`${verify.pathname}${verify.search}`, server.origin);
  }
  if (verify.protocol !== "http:" && verify.protocol !== "https:") return undefined;
  const native = new URL(NATIVE_SIGN_IN_URL);
  native.searchParams.set("link", verify.toString());
  return native.toString();
};

export interface AuthLinkArgs {
  readonly ios: boolean;
  readonly server: string | undefined;
}

/** `bun run auth:link [--ios] [--server <origin>]`. Unknown flags are ignored. */
export const parseAuthLinkArgs = (argv: ReadonlyArray<string>): AuthLinkArgs => {
  const serverIndex = argv.indexOf("--server");
  const server = serverIndex >= 0 ? argv[serverIndex + 1] : undefined;
  return { ios: argv.includes("--ios") || server !== undefined, server };
};
