import { beforeEach, describe, expect, it } from "vitest";

import type { Job } from "@/lib/shared/types";

import { ev, resetClock } from "../../../../tests/fixtures/events";
import { makeResults } from "../../../../tests/fixtures/results";
import { jobIdFromSearch, withJobId } from "./job-url";
import { DEFAULT_OPTIONS_DRAFT, draftToOptions } from "./options";
import { currentStage, initialSession, isBusy, sessionReducer, type SessionAction, type SessionState } from "./session";
import { appendLine, eventToLine } from "./terminal";

beforeEach(() => resetClock());

const NOW = 1_794_213_000_000;
const job = { id: "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b" } as Job;
const run = (actions: SessionAction[], from: SessionState = initialSession) => actions.reduce(sessionReducer, from);
const fileStart: SessionAction = { type: "begin", now: NOW, source: { kind: "file", name: "GX.MP4", size: 2_000_000, objectUrl: "blob:x" } };

// ------------------------------------------------------------------ terminal

describe("eventToLine", () => {
  it("formats each event kind with a tone and tag", () => {
    expect(eventToLine(ev.stage(1, "imu", "start", "Extracting IMU"))).toMatchObject({ tone: "accent", tag: "IMU", text: "▸ Extracting IMU" });
    expect(eventToLine(ev.stage(2, "imu", "done", "970,019 samples", { elapsed_s: 16.47 }))).toMatchObject({ tone: "success", text: "✓ 970,019 samples (16.5 s)" });
    expect(eventToLine(ev.stage(3, "download", "skip", "Local file"))).toMatchObject({ tone: "muted", text: "– Local file" });
    expect(eventToLine(ev.progress(4, "qc", 9, 75, "Analysed frame 9/75"))).toMatchObject({ text: "Analysed frame 9/75 · 12%", progressKey: "qc" });
    expect(eventToLine(ev.progress(5, "download", 9, null, "Downloaded 9 B"))!.text).toBe("Downloaded 9 B");
    expect(eventToLine(ev.log(6, "Check gyro_bias: FAIL", "warning", "probing_qc.imu.checks"))).toMatchObject({ tone: "warning", tag: "checks" });
    expect(eventToLine(ev.log(7, "raw", "native", "stderr"))).toMatchObject({ tone: "muted", tag: "stderr" });
    expect(eventToLine(ev.error(8, "bad gpmf", "imu"))).toMatchObject({ tone: "error", tag: "IMU", text: "✕ bad gpmf [ValueError]" });
    expect(eventToLine(ev.job(9, "failed", "Pipeline exited with code 1"))).toMatchObject({ tone: "error", tag: "job" });
  });
});

describe("appendLine", () => {
  const draft = (text: string, progressKey?: string) => ({ t: 1, tone: "default" as const, tag: "x", text, ...(progressKey ? { progressKey } : {}) });

  it("updates a trailing progress line in place", () => {
    let b = appendLine({ lines: [], nextId: 1 }, draft("a"), 10);
    b = appendLine(b, draft("p1", "qc"), 10);
    b = appendLine(b, draft("p2", "qc"), 10);
    expect(b.lines.map((l) => [l.id, l.text])).toEqual([[1, "a"], [2, "p2"]]);
    b = appendLine(b, draft("log"), 10);
    b = appendLine(b, draft("p3", "qc"), 10); // no longer last -> new line
    expect(b.lines.map((l) => l.text)).toEqual(["a", "p2", "log", "p3"]);
  });

  it("drops the oldest lines past the cap", () => {
    let b = { lines: [] as ReturnType<typeof appendLine>["lines"], nextId: 1 };
    for (let i = 0; i < 5; i += 1) b = appendLine(b, draft(String(i)), 3);
    expect(b.lines.map((l) => l.text)).toEqual(["2", "3", "4"]);
  });
});

// ------------------------------------------------------------------ session

describe("sessionReducer", () => {
  it("walks an upload through to results", () => {
    let s = run([fileStart]);
    expect([s.phase, s.stages.download.status, isBusy(s.phase)]).toEqual(["uploading", "active", true]);

    s = run([
      { type: "uploadProgress", loaded: 500_000, total: 2_000_000, now: NOW },
      { type: "uploadProgress", loaded: 1_000_000, total: 2_000_000, now: NOW },
    ], s);
    expect(s.stages.download.progress).toBe(0.5);
    expect(s.lines.filter((l) => l.progressKey === "upload")).toHaveLength(1); // updated in place

    s = run([
      { type: "uploaded", upload: { uploadId: "u", fileName: "GX.MP4", sizeBytes: 2_000_000 }, now: NOW },
      { type: "jobCreated", job, now: NOW },
      { type: "event", event: ev.job(1, "queued") },
      { type: "event", event: ev.job(2, "running") },
      { type: "event", event: ev.stage(3, "download", "skip", "Local file") },
      { type: "event", event: ev.stage(4, "probe", "start") },
      { type: "event", event: ev.stage(5, "probe", "done", "HEVC 1920x1080", { codec: "hevc", display_width: 1920 }) },
      { type: "event", event: ev.progress(6, "qc", 30, 60) },
    ], s);
    expect(s.phase).toBe("processing");
    expect(s.stages.download.status).toBe("done");     // skip does not undo the browser upload
    expect(s.video).toMatchObject({ codec: "hevc", display_width: 1920 });
    expect(s.stages.qc).toMatchObject({ status: "active", progress: 0.5 });
    expect(currentStage(s)).toBe("qc");

    s = run([
      { type: "event", event: ev.stage(7, "qc", "done") },
      { type: "event", event: ev.job(8, "succeeded") },
    ], s);
    expect(s.phase).toBe("loadingResults");
    s = run([{ type: "resultsLoaded", results: makeResults(), now: NOW }], s);
    expect([s.phase, isBusy(s.phase), s.results?.video.file]).toEqual(["done", false, "GX010140.MP4"]);
  });

  it("ignores events replayed after a reconnect", () => {
    const s = run([fileStart, { type: "jobCreated", job, now: NOW }, { type: "event", event: ev.log(1, "a") }, { type: "event", event: ev.log(2, "b") }]);
    const replayed = run([{ type: "event", event: ev.log(1, "a") }, { type: "event", event: ev.log(2, "b") }], s);
    expect(replayed.lines).toHaveLength(s.lines.length);
    expect(replayed.lastSeq).toBe(2);
  });

  it("drops late events after a reset", () => {
    const s = run([fileStart, { type: "jobCreated", job, now: NOW }, { type: "reset" }, { type: "event", event: ev.log(5, "late") }]);
    expect(s).toEqual(initialSession);
  });

  it("records pipeline failures on the failing stage", () => {
    const s = run([
      { type: "begin", now: NOW, source: { kind: "url", url: "https://x/v.mp4", name: "v.mp4" } },
      { type: "jobCreated", job, now: NOW },
      { type: "event", event: ev.stage(1, "download", "start") },
      { type: "event", event: ev.error(2, "404 Not Found", "download") },
      { type: "event", event: ev.job(3, "failed", "404 Not Found") },
    ]);
    expect([s.phase, s.error, s.stages.download.status]).toEqual(["failed", "404 Not Found", "failed"]);
  });

  it("marks the active stage failed on a local error (e.g. upload rejected)", () => {
    const s = run([fileStart, { type: "failed", message: "The file is larger than the limit.", now: NOW }]);
    expect([s.phase, s.stages.download.status]).toEqual(["failed", "failed"]);
    expect(s.lines.at(-1)?.tone).toBe("error");
  });

  it("ignores upload progress outside the upload phase", () => {
    const s = run([{ type: "uploadProgress", loaded: 1, total: 2, now: NOW }]);
    expect(s).toBe(initialSession);
  });

  it("goes to cancelled on the server's cancel event", () => {
    const s = run([fileStart, { type: "jobCreated", job, now: NOW }, { type: "event", event: ev.job(1, "cancelled") }]);
    expect(s.phase).toBe("cancelled");
  });
});

describe("resume", () => {
  const uploadJob = {
    id: job.id, status: "succeeded", options: { hands: true, imu: true }, createdAt: "2026-11-09T00:00:00Z",
    source: { kind: "upload", uploadId: "u", fileName: "GX.MP4", sizeBytes: 2_000_000 },
  } as Job;

  it("rebuilds the session from a stored job, then from replayed events", () => {
    let s = run([{ type: "resume", job: uploadJob, now: NOW }]);
    expect(s).toMatchObject({ phase: "queued", jobId: job.id, source: { kind: "file", name: "GX.MP4", objectUrl: null } });
    expect(s.stages.download.status).toBe("done");
    s = run([
      { type: "event", event: ev.job(1, "queued") },
      { type: "event", event: ev.job(2, "running") },
      { type: "event", event: ev.stage(3, "download", "skip") },
      { type: "event", event: ev.job(4, "succeeded") },
    ], s);
    expect([s.phase, s.stages.download.status]).toEqual(["loadingResults", "done"]);
  });

  it("maps a URL job back to a link source", () => {
    const s = run([{ type: "resume", job: { ...uploadJob, source: { kind: "url", url: "https://x/v.mp4", fileName: "v.mp4" } }, now: NOW }]);
    expect(s.source).toEqual({ kind: "url", url: "https://x/v.mp4", name: "v.mp4" });
    expect(s.stages.download.status).toBe("pending");
  });
});

describe("job-url", () => {
  it("reads only well-formed ids", () => {
    expect(jobIdFromSearch(`?job=${job.id}`)).toBe(job.id);
    expect(jobIdFromSearch("?job=../../etc")).toBeNull();
    expect(jobIdFromSearch("")).toBeNull();
  });

  it("sets and clears the param, keeping the rest of the URL", () => {
    expect(withJobId("http://h/qc?x=1#top", job.id)).toBe(`/qc?x=1&job=${job.id}#top`);
    expect(withJobId(`http://h/qc?job=${job.id}&x=1`, null)).toBe("/qc?x=1");
  });
});

// ------------------------------------------------------------------ options

describe("draftToOptions", () => {
  it("treats blank fields as defaults", () => {
    expect(draftToOptions(DEFAULT_OPTIONS_DRAFT)).toEqual({ ok: true, value: { hands: true, imu: true } });
  });

  it("parses filled fields and reports bad ones", () => {
    expect(draftToOptions({ ...DEFAULT_OPTIONS_DRAFT, maxSeconds: " 60 ", frameStride: "2", hands: false }))
      .toEqual({ ok: true, value: { maxSeconds: 60, frameStride: 2, hands: false, imu: true } });
    expect(draftToOptions({ ...DEFAULT_OPTIONS_DRAFT, startS: "-3" }).ok).toBe(false);
  });
});
