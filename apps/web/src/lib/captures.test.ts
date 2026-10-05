/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { Capture } from "@bloom/domain";
import { Schema } from "effect";
import { captureSummary } from "./captures";

const capture = (
  kind: "text" | "share" | "image" | "voice",
  payload: unknown,
  transcript: string | null = null,
) =>
  Schema.decodeUnknownSync(Capture.json)({
    id: "019a0000-0000-7000-8000-0000000000c1",
    kind,
    payload,
    transcript,
    status: "new",
    routedTo: null,
    createdAt: "2026-10-05T07:30:00.000Z",
    updatedAt: "2026-10-05T07:30:00.000Z",
  });

describe("captureSummary", () => {
  it("shows a shared link by its title, with the host as detail", () => {
    expect(
      captureSummary(capture("share", { url: "https://example.com/a", title: "An article" })),
    ).toEqual({
      title: "An article",
      detail: "example.com",
      url: "https://example.com/a",
      image: null,
    });
    expect(captureSummary(capture("share", { url: "https://example.com/a" })).title).toBe(
      "example.com",
    );
  });

  it("never links anything but http(s)", () => {
    expect(
      captureSummary(capture("share", { url: "javascript:alert(1)", title: "x" })).url,
    ).toBeNull();
  });

  it("reads text, voice and image captures", () => {
    expect(captureSummary(capture("text", { text: " Buy stamps " })).title).toBe("Buy stamps");
    expect(
      captureSummary(capture("voice", { dataUrl: "data:audio/m4a;base64,AA" }, "Call mum")).title,
    ).toBe("Call mum");
    const photo = captureSummary(
      capture("image", { dataUrl: "data:image/jpeg;base64,/9j/", width: 1, height: 1 }),
    );
    expect(photo.title).toBe("Photo");
    expect(photo.image).toBe("data:image/jpeg;base64,/9j/");
    expect(
      captureSummary(capture("image", { dataUrl: "https://evil.example/x.jpg" })).image,
    ).toBeNull();
  });

  it("survives payloads that are not objects", () => {
    expect(captureSummary(capture("text", null)).title).toBe("Note");
    expect(captureSummary(capture("share", ["x"])).title).toBe("Shared item");
  });
});
