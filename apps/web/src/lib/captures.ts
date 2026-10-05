/**
 * How a capture reads in a list, from its free-form payload (ADR 0019).
 * The Swift twin is `CaptureSummary` in apps/ios/BloomKit.
 */
import type { CaptureJson } from "./types";

export interface CaptureSummary {
  readonly title: string;
  readonly detail: string | null;
  readonly url: string | null;
  /** A `data:image/...` URL for image captures, usable as an `<img src>`. */
  readonly image: string | null;
}

const field = (payload: unknown, key: string): string | null => {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const value: unknown = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
};

const hostOf = (url: string | null): string | null => {
  if (url === null || !URL.canParse(url)) return null;
  return new URL(url).host;
};

export const captureSummary = (capture: CaptureJson): CaptureSummary => {
  const { payload } = capture;
  const url = field(payload, "url");
  const safeUrl = url !== null && /^https?:\/\//.test(url) ? url : null;
  switch (capture.kind) {
    case "text":
      return {
        title: field(payload, "text") ?? capture.transcript ?? "Note",
        detail: null,
        url: null,
        image: null,
      };
    case "share": {
      const title = field(payload, "title");
      return {
        title: title ?? field(payload, "text") ?? hostOf(safeUrl) ?? "Shared item",
        detail: title === null ? hostOf(safeUrl) : (field(payload, "text") ?? hostOf(safeUrl)),
        url: safeUrl,
        image: null,
      };
    }
    case "image": {
      const dataUrl = field(payload, "dataUrl");
      return {
        title: field(payload, "caption") ?? "Photo",
        detail: null,
        url: null,
        image: dataUrl !== null && dataUrl.startsWith("data:image/") ? dataUrl : null,
      };
    }
    case "voice":
      return { title: capture.transcript ?? "Voice memo", detail: null, url: null, image: null };
  }
};
