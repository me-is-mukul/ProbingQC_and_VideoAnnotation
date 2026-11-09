import { describe, expect, it } from "vitest";

import {
  fileNameFromUrl, hasVideoExtension, isId, isPrivateHost, sanitizeFileName, validateCreateJobRequest,
  validateJobOptions, validateVideoUrl,
} from "./validation";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("ids and file names", () => {
  it("accepts only UUID v4 ids", () => {
    expect(isId(ID)).toBe(true);
    expect(isId(ID.toUpperCase())).toBe(false);
    expect(isId("../../etc/passwd")).toBe(false);
    expect(isId(`${ID}/..`)).toBe(false);
    expect(isId(42)).toBe(false);
  });

  it("checks video extensions case-insensitively", () => {
    expect(hasVideoExtension("GX010140.MP4")).toBe(true);
    expect(hasVideoExtension("clip.mov")).toBe(true);
    expect(hasVideoExtension("clip.mkv")).toBe(false);
    expect(hasVideoExtension("mp4")).toBe(false);
  });

  it.each([
    ["GX010140.MP4", "GX010140.MP4"],
    ["C:\\Users\\me\\Videos\\clip.mp4", "clip.mp4"],
    ["../../evil.mp4", "evil.mp4"],
    ["..mp4.mp4", "mp4.mp4"],
    ["my  clip?.mp4", "my clip_.mp4"],
    ["tab\there.mp4", "tab_here.mp4"], // control characters are replaced, not collapsed
    ["notes.txt", null],
    ["", null],
    [".mp4", null],
  ])("sanitizeFileName(%j) -> %j", (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it("caps long names but keeps the extension", () => {
    const out = sanitizeFileName(`${"a".repeat(300)}.mp4`, 40)!;
    expect(out).toHaveLength(40);
    expect(out.endsWith(".mp4")).toBe(true);
  });

  it("derives the download file name like the Python side", () => {
    expect(fileNameFromUrl(new URL("https://x.org/a/My%20Clip.mp4?sig=1"))).toBe("My Clip.mp4");
    expect(fileNameFromUrl(new URL("https://x.org/a/"))).toBe("");
    expect(fileNameFromUrl(new URL("https://x.org/a/..%2F..%2Fevil.mp4"))).toBe("evil.mp4");
    expect(fileNameFromUrl(new URL("https://x.org/a/bad%E0.mp4"))).toBe("bad%E0.mp4");
  });
});

describe("validateVideoUrl", () => {
  it.each(["localhost", "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.10", "169.254.169.254", "[::1]", "metadata.google.internal", "100.64.0.1"])(
    "treats %s as private",
    (host) => {
      expect(isPrivateHost(host)).toBe(true);
      expect(validateVideoUrl(`http://${host}/v.mp4`).ok).toBe(false);
    },
  );

  it.each(["storage.googleapis.com", "8.8.8.8", "172.32.0.1", "example.com"])("treats %s as public", (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });

  it("allows private hosts only when configured", () => {
    expect(validateVideoUrl("http://localhost:9000/v.mp4", { allowPrivate: true }).ok).toBe(true);
  });

  it.each(["", "   ", "not a url", "ftp://x.org/v.mp4", "file:///etc/passwd", "https://user:pw@x.org/v.mp4"])("rejects %j", (input) => {
    expect(validateVideoUrl(input).ok).toBe(false);
  });

  it("trims and accepts a normal link", () => {
    const r = validateVideoUrl("  https://x.org/GX010140.MP4  ");
    expect(r.ok && r.value.hostname).toBe("x.org");
  });
});

describe("validateJobOptions", () => {
  it("defaults the switches on and leaves numbers unset", () => {
    expect(validateJobOptions(undefined)).toEqual({ ok: true, value: { hands: true, imu: true } });
  });

  it("accepts numbers and numeric strings", () => {
    const r = validateJobOptions({ frameStride: "8", startS: 600, maxSeconds: "60.5", hands: false });
    expect(r).toEqual({ ok: true, value: { frameStride: 8, startS: 600, maxSeconds: 60.5, hands: false, imu: true } });
  });

  it.each([
    [{ frameStride: 0 }, "Frame stride"],
    [{ frameStride: 1.5 }, "whole number"],
    [{ frameStride: "abc" }, "must be a number"],
    [{ startS: -1 }, "Start"],
    [{ maxSeconds: 0 }, "Duration"],
    [{ maxSeconds: Infinity }, "must be a number"],
    [{ hands: "yes" }, "hands"],
  ])("rejects %j", (input, message) => {
    const r = validateJobOptions(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });
});

describe("validateCreateJobRequest", () => {
  it("accepts an upload source", () => {
    const r = validateCreateJobRequest({ source: { kind: "upload", uploadId: ID } });
    expect(r.ok && r.value.source).toEqual({ kind: "upload", uploadId: ID });
  });

  it("accepts a url source and returns a URL object", () => {
    const r = validateCreateJobRequest({ source: { kind: "url", url: "https://x.org/v.mp4" }, options: { maxSeconds: 60 } });
    expect(r.ok && r.value.source.kind === "url" && r.value.source.url.href).toBe("https://x.org/v.mp4");
  });

  it.each([
    [null, "JSON object"],
    [{}, "`source` is required"],
    [{ source: { kind: "upload", uploadId: "../x" } }, "upload id"],
    [{ source: { kind: "url", url: 5 } }, "must be a string"],
    [{ source: { kind: "url", url: "http://127.0.0.1/v.mp4" } }, "private"],
    [{ source: { kind: "path", path: "/etc/passwd" } }, "source.kind"],
    [{ source: { kind: "upload", uploadId: ID }, options: { frameStride: -1 } }, "Frame stride"],
  ])("rejects %j", (body, message) => {
    const r = validateCreateJobRequest(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });
});
