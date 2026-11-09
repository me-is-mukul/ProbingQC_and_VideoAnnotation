import fs from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseSSE } from "@/lib/shared/sse";
import type { Job, StoredEvent } from "@/lib/shared/types";

import { makeJobService, pyEvent, streamOf } from "../../../../tests/helpers/server";
import { ApiError } from "../http";
import { createJobEventStream, type JobEventSource } from "./event-stream";

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function setup(concurrency = 1) {
  const ctx = await makeJobService({ concurrency });
  cleanups.push(ctx.dataDir);
  const upload = await ctx.uploads.save(streamOf("fake video bytes"), "GX010140.MP4");
  const createUploadJob = () =>
    ctx.service.create({ source: { kind: "upload", uploadId: upload.uploadId }, options: { hands: true, imu: true } });
  return { ...ctx, upload, createUploadJob };
}

const waitForStatus = async (service: { get(id: string): Promise<Job | null> }, id: string, status: Job["status"]) =>
  vi.waitFor(async () => expect((await service.get(id))?.status).toBe(status));

// ------------------------------------------------------------------ store

describe("FileJobStore", () => {
  it("creates, updates and lists jobs, newest first", async () => {
    const { store, dataDir } = await setup();
    const a: Job = { id: "11111111-1111-4111-8111-111111111111", status: "queued", source: { kind: "url", url: "https://x/a.mp4", fileName: "a.mp4" }, options: { hands: true, imu: true }, createdAt: "2026-01-01T00:00:00Z" };
    const b = { ...a, id: "22222222-2222-4222-8222-222222222222", createdAt: "2026-01-02T00:00:00Z" };
    await store.create(a);
    await store.create(b);
    expect((await store.update(a.id, { status: "running" })).status).toBe("running");
    expect((await store.list()).map((j) => j.id)).toEqual([b.id, a.id]);
    expect(await store.get("33333333-3333-4333-8333-333333333333")).toBeNull();
    await fs.writeFile(`${dataDir}/jobs/not-a-job`, "x"); // stray files are ignored by list()
    expect(await store.list()).toHaveLength(2);
  });

  it("assigns gap-free sequence numbers under concurrent appends and survives a torn line", async () => {
    const { store, paths } = await setup();
    const id = "44444444-4444-4444-8444-444444444444";
    await store.create({ id, status: "queued", source: { kind: "url", url: "https://x/a.mp4", fileName: "a.mp4" }, options: { hands: true, imu: true }, createdAt: "2026-01-01T00:00:00Z" });
    const log = (m: string) => ({ v: 1, t: 1, type: "log" as const, level: "info" as const, logger: "", message: m });
    const stored = await Promise.all(Array.from({ length: 25 }, (_, i) => store.appendEvent(id, log(String(i)))));
    expect(stored.map((e) => e.seq).sort((x, y) => x - y)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    await fs.appendFile(paths.jobFile(id, "events.jsonl"), '{"seq": 26, "type": "lo'); // crash mid-write
    const replay = await store.readEvents(id, 20);
    expect(replay.map((e) => e.seq)).toEqual([21, 22, 23, 24, 25]);
  });
});

// ------------------------------------------------------------------ service

describe("JobService", () => {
  it("runs an upload job: queued -> running -> succeeded, recording every Python event", async () => {
    const { service, runner, createUploadJob, upload } = await setup();
    const job = await createUploadJob();
    expect(job.source).toMatchObject({ kind: "upload", fileName: "GX010140.MP4" });

    await vi.waitFor(() => expect(runner.started).toHaveLength(1));
    const p = runner.last;
    expect(p.command.args).toContain("--video");
    expect(p.command.args).toContain(upload.path);
    p.stdout(pyEvent("stage", { stage: "probe", status: "start", message: "Reading" }));
    p.stderr("W0000 inference_feedback_manager.cc:121] Feedback manager requires a model");
    p.stdout("this line is not JSON");
    p.stdout(pyEvent("result", { path: "results.json", message: "Processing complete" }));
    p.exit(0);
    await waitForStatus(service, job.id, "succeeded");

    const events = await service.events(job.id);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.map((e) => (e.type === "job" ? `job:${e.status}` : e.type))).toEqual([
      "job:queued", "job:running", "stage", "log", "log", "result", "job:succeeded",
    ]);
    const native = events.filter((e) => e.type === "log");
    expect(native.every((e) => e.type === "log" && e.level === "native")).toBe(true);
    expect((await service.get(job.id))?.exitCode).toBe(0);
  });

  it("marks the job failed with the pipeline's own error message", async () => {
    const { service, runner, createUploadJob } = await setup();
    const job = await createUploadJob();
    await vi.waitFor(() => expect(runner.started).toHaveLength(1));
    runner.last.stdout(pyEvent("error", { stage: "imu", message: "Truncated GPMF entry", error_type: "ValueError" }));
    runner.last.exit(1);
    await waitForStatus(service, job.id, "failed");
    expect((await service.get(job.id))?.error).toEqual({ message: "Truncated GPMF entry", stage: "imu" });
  });

  it("reports a missing interpreter clearly", async () => {
    const { service, runner, createUploadJob } = await setup();
    const job = await createUploadJob();
    await vi.waitFor(() => expect(runner.started).toHaveLength(1));
    runner.last.exit(null, { spawnError: "spawn /venv/bin/python ENOENT" });
    await waitForStatus(service, job.id, "failed");
    const last = (await service.events(job.id)).at(-1)!;
    expect(last.type === "job" && last.message).toContain("Could not start the pipeline");
  });

  it("queues jobs beyond the concurrency limit and cancels queued ones without running them", async () => {
    const { service, runner, createUploadJob } = await setup(1);
    const first = await createUploadJob();
    const second = await createUploadJob();
    await vi.waitFor(() => expect(runner.started).toHaveLength(1));
    const queuedMsg = (await service.events(second.id))[0]!;
    expect(queuedMsg.type === "job" && queuedMsg.message).toMatch(/Queued behind 1 job/);

    expect((await service.cancel(second.id)).status).toBe("cancelled");
    runner.last.exit(0);
    await waitForStatus(service, first.id, "succeeded");
    expect(runner.started).toHaveLength(1); // the cancelled job never started
  });

  it("cancels a running job by killing its process", async () => {
    const { service, runner, createUploadJob } = await setup();
    const job = await createUploadJob();
    await vi.waitFor(() => expect(runner.started).toHaveLength(1));
    await service.cancel(job.id);
    expect(runner.last.killed).toBe(true);
    await waitForStatus(service, job.id, "cancelled");
    await expect(service.cancel(job.id)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects unknown uploads and gates results on success", async () => {
    const { service, createUploadJob, runner } = await setup();
    await expect(service.create({ source: { kind: "upload", uploadId: "55555555-5555-4555-8555-555555555555" }, options: { hands: true, imu: true } }))
      .rejects.toBeInstanceOf(ApiError);
    const job = await createUploadJob();
    await expect(service.resultsPath(job.id)).rejects.toMatchObject({ status: 409 });
    await vi.waitFor(() => expect(runner.started).toHaveLength(1));
    runner.last.exit(0);
    await waitForStatus(service, job.id, "succeeded");
    expect(await service.resultsPath(job.id)).toMatch(/results\.json$/);
  });

  it("builds URL jobs with the derived file name", async () => {
    const { service, runner } = await setup();
    const job = await service.create({ source: { kind: "url", url: new URL("https://x.org/a/GX010146.MP4") }, options: { hands: false, imu: true, maxSeconds: 60 } });
    expect(job.source).toEqual({ kind: "url", url: "https://x.org/a/GX010146.MP4", fileName: "GX010146.MP4" });
    await vi.waitFor(() => expect(runner.started).toHaveLength(1));
    expect(runner.last.command.args).toEqual(expect.arrayContaining(["--url", "https://x.org/a/GX010146.MP4", "--max-seconds", "60", "--no-hands"]));
    runner.last.exit(0);
    await waitForStatus(service, job.id, "succeeded"); // let the service finish writing before cleanup
  });

  it("recovers jobs interrupted by a restart", async () => {
    const { service, store, createUploadJob, runner } = await setup();
    const job = await createUploadJob();
    await vi.waitFor(() => expect(runner.started).toHaveLength(1));
    await store.update(job.id, { status: "running" });
    // a new process would start with an empty queue and call recoverInterrupted()
    expect(await service.recoverInterrupted()).toBe(1);
    expect((await store.get(job.id))?.status).toBe("failed");
  });
});

// ------------------------------------------------------------------ SSE stream

const evt = (seq: number, type: "log" | "job" = "log", status = "running"): StoredEvent =>
  type === "job"
    ? { v: 1, t: 1, seq, type: "job", status: status as Job["status"], message: status }
    : { v: 1, t: 1, seq, type: "log", level: "info", logger: "", message: `m${seq}` };

class FakeSource implements JobEventSource {
  listeners = new Set<(e: StoredEvent) => void>();
  constructor(public stored: StoredEvent[], public status: Job["status"]) {}
  async get() {
    return { status: this.status } as Job;
  }
  async events(_id: string, after: number) {
    return this.stored.filter((e) => e.seq > after);
  }
  subscribe(_id: string, l: (e: StoredEvent) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  push(e: StoredEvent) {
    this.stored.push(e);
    this.listeners.forEach((l) => l(e));
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return text;
    text += decoder.decode(value);
  }
}

const seqs = (text: string) => parseSSE(text).filter((m) => m.data).map((m) => Number(m.id));

describe("createJobEventStream", () => {
  it("replays a finished job from Last-Event-ID and closes", async () => {
    const source = new FakeSource([evt(1), evt(2), evt(3), evt(4, "job", "succeeded")], "succeeded");
    const text = await readAll(createJobEventStream(source, "j", 2, new AbortController().signal));
    expect(seqs(text)).toEqual([3, 4]);
    expect(text.startsWith("retry: 2000")).toBe(true);
  });

  it("closes even when the terminal event was already seen", async () => {
    const source = new FakeSource([evt(1), evt(2, "job", "failed")], "failed");
    expect(seqs(await readAll(createJobEventStream(source, "j", 2, new AbortController().signal)))).toEqual([]);
  });

  it("streams live events without duplicates and ends on the terminal event", async () => {
    const source = new FakeSource([evt(1)], "running");
    const stream = createJobEventStream(source, "j", 0, new AbortController().signal);
    const done = readAll(stream);
    await vi.waitFor(() => expect(source.listeners.size).toBe(1));
    source.push(evt(2));
    source.listeners.forEach((l) => l(evt(2))); // duplicate delivery
    source.push(evt(3, "job", "succeeded"));
    expect(seqs(await done)).toEqual([1, 2, 3]);
    expect(source.listeners.size).toBe(0); // unsubscribed
  });

  it("stops and unsubscribes when the client disconnects", async () => {
    const source = new FakeSource([], "running");
    const abort = new AbortController();
    const done = readAll(createJobEventStream(source, "j", 0, abort.signal));
    await vi.waitFor(() => expect(source.listeners.size).toBe(1));
    abort.abort();
    await done;
    expect(source.listeners.size).toBe(0);
  });

  it("sends heartbeats while idle", async () => {
    vi.useFakeTimers();
    try {
      const source = new FakeSource([], "running");
      const stream = createJobEventStream(source, "j", 0, new AbortController().signal, { heartbeatMs: 1000 });
      const reader = stream.getReader();
      await reader.read(); // retry hint
      await vi.advanceTimersByTimeAsync(1000);
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toBe(": keep-alive\n\n");
      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});
