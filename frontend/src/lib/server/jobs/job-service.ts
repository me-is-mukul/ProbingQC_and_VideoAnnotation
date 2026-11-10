import "server-only";

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { parseEventLine } from "@/lib/shared/events";
import type { Job, JobStatus, PipelineEvent, PythonEvent, QCResults, StoredEvent } from "@/lib/shared/types";
import { fileNameFromUrl, type ValidatedJobRequest } from "@/lib/shared/validation";

import type { DataPaths } from "../data-paths";
import { conflict, notFound } from "../http";
import type { UploadStore } from "../uploads/upload-store";
import type { EventHub } from "./event-hub";
import type { JobQueue } from "./job-queue";
import type { JobStore } from "./job-store";
import { buildPipelineCommand } from "./pipeline-command";
import type { ProcessHandle, ProcessRunner } from "./process-runner";

export interface JobServiceDeps {
  store: JobStore;
  hub: EventHub;
  queue: JobQueue;
  runner: ProcessRunner;
  uploads: UploadStore;
  paths: DataPaths;
  pythonBin: string;
  pipelineRoot: string;
  now?: () => Date;
  newId?: () => string;
}

const MAX_NATIVE_LINE = 500;

/**
 * Owns the job lifecycle: create -> queued -> running -> succeeded | failed | cancelled.
 * Every state change and every pipeline event is persisted (JobStore) and then broadcast
 * (EventHub), in that order, so a client that reconnects can always replay what it missed.
 */
export class JobService {
  private readonly running = new Map<string, ProcessHandle>();
  private readonly cancelled = new Set<string>();
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly deps: JobServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? randomUUID;
  }

  async create(request: ValidatedJobRequest): Promise<Job> {
    let source: Job["source"];
    if (request.source.kind === "upload") {
      const upload = await this.deps.uploads.get(request.source.uploadId);
      if (!upload) throw notFound("Upload");
      source = { kind: "upload", uploadId: upload.uploadId, fileName: upload.fileName, sizeBytes: upload.sizeBytes };
    } else {
      const url = request.source.url;
      source = { kind: "url", url: url.toString(), fileName: fileNameFromUrl(url) || "video.mp4" };
    }

    const job: Job = {
      id: this.newId(),
      status: "queued",
      source,
      options: request.options,
      createdAt: this.now().toISOString(),
    };
    await this.deps.store.create(job);
    const position = this.deps.queue.pendingCount + this.deps.queue.runningCount;
    await this.record(job.id, this.jobEvent("queued", position > 0
      ? `Queued behind ${position} job${position === 1 ? "" : "s"}`
      : "Queued; starting shortly"));
    this.deps.queue.enqueue(job.id, () => this.execute(job.id));
    return job;
  }

  get(id: string): Promise<Job | null> {
    return this.deps.store.get(id);
  }

  async require(id: string): Promise<Job> {
    const job = await this.deps.store.get(id);
    if (!job) throw notFound("Job");
    return job;
  }

  events(id: string, afterSeq = 0): Promise<StoredEvent[]> {
    return this.deps.store.readEvents(id, afterSeq);
  }

  subscribe(id: string, listener: (event: StoredEvent) => void): () => void {
    return this.deps.hub.subscribe(id, listener);
  }

  async cancel(id: string): Promise<Job> {
    const job = await this.require(id);
    if (job.status !== "queued" && job.status !== "running") throw conflict(`Job is already ${job.status}.`);
    this.cancelled.add(id);
    if (this.deps.queue.remove(id)) {
      return this.finish(id, "cancelled", "Cancelled before it started", { exitCode: null });
    }
    this.running.get(id)?.kill(); // execute() records the final status when the process exits
    return job;
  }

  /** Path of results.json once the job succeeded. */
  async resultsPath(id: string): Promise<string> {
    const job = await this.require(id);
    if (job.status !== "succeeded") throw conflict(`Results are not available while the job is ${job.status}.`);
    return this.deps.paths.jobFile(id, "results.json");
  }

  /** results.json, parsed (only once the job has succeeded). */
  async readResults(id: string): Promise<QCResults> {
    const file = await this.resultsPath(id);
    const text = await fs.readFile(file, "utf8").catch(() => {
      throw notFound("Results");
    });
    return JSON.parse(text) as QCResults;
  }

  /**
   * An output listed in results.json `files` (the per-frame table or the IMU CSV). The
   * path comes from the job's own results and is still confined to the job folder.
   */
  async outputPath(id: string, key: "frames_csv" | "imu_csv"): Promise<string> {
    const what = key === "imu_csv" ? "IMU data" : "Frame table";
    const relative = (await this.readResults(id)).files?.[key];
    if (typeof relative !== "string" || !relative) throw notFound(what);
    let file: string;
    try {
      file = this.deps.paths.insideJob(id, relative);
    } catch {
      throw notFound(what);
    }
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) throw notFound(what);
    return file;
  }

  /** The video file a job processed (uploaded file, or the downloaded copy). */
  async videoPath(id: string): Promise<string> {
    const job = await this.require(id);
    if (job.source.kind === "upload") {
      const upload = await this.deps.uploads.get(job.source.uploadId);
      if (!upload) throw notFound("Video");
      return upload.path;
    }
    const sourceDir = this.deps.paths.insideJob(id, "source");
    const files = await fs.readdir(sourceDir).catch(() => [] as string[]);
    const video = files.find((f) => !f.endsWith(".part"));
    if (!video) throw notFound("Video");
    return path.join(sourceDir, video);
  }

  /** Mark jobs left queued/running by a previous server process as failed. Call once at startup. */
  async recoverInterrupted(): Promise<number> {
    const stale = (await this.deps.store.list()).filter((j) => j.status === "queued" || j.status === "running");
    for (const job of stale) {
      await this.finish(job.id, "failed", "Interrupted: the server restarted while this job was in progress",
        { exitCode: null, error: { message: "Server restarted", stage: null } });
    }
    return stale.length;
  }

  // ------------------------------------------------------------------ internals

  private async execute(id: string): Promise<void> {
    if (this.cancelled.has(id)) return;
    const job = await this.require(id);
    const video = job.source.kind === "upload" ? (await this.deps.uploads.get(job.source.uploadId))?.path : undefined;
    if (job.source.kind === "upload" && !video) {
      await this.finish(id, "failed", "The uploaded video is no longer available", {
        exitCode: null, error: { message: "Upload missing", stage: null },
      });
      return;
    }

    const command = buildPipelineCommand({
      pythonBin: this.deps.pythonBin,
      pipelineRoot: this.deps.pipelineRoot,
      jobDir: this.deps.paths.jobDir(id),
      ...(video ? { video } : { url: (job.source as { url: string }).url }),
      options: job.options,
    });

    if (this.cancelled.has(id)) {
      // cancel() arrived after the queue handed us the job but before a process existed
      await this.finish(id, "cancelled", "Cancelled before it started", { exitCode: null });
      return;
    }
    await this.deps.store.update(id, { status: "running", startedAt: this.now().toISOString() });
    await this.record(id, this.jobEvent("running", "Pipeline started"));

    // Events are recorded in arrival order through one chain, so seq follows stdout order.
    let chain: Promise<unknown> = Promise.resolve();
    let lastError: PythonEvent | null = null;
    const enqueue = (event: PipelineEvent) => {
      chain = chain.then(() => this.record(id, event)).catch((e) => console.error("[jobs] record failed", e));
    };

    const handle = this.deps.runner.start(command, {
      onStdoutLine: (line) => {
        const event = parseEventLine(line);
        if (event) {
          if (event.type === "error") lastError = event;
          enqueue(event);
        } else {
          enqueue(this.nativeLog(line));
        }
      },
      onStderrLine: (line) => enqueue(this.nativeLog(line)),
    });
    this.running.set(id, handle);

    const exit = await handle.exited;
    this.running.delete(id);
    await chain;

    const err = lastError as PythonEvent | null;
    if (this.cancelled.has(id)) {
      await this.finish(id, "cancelled", "Cancelled", { exitCode: exit.exitCode });
    } else if (exit.spawnError) {
      await this.finish(id, "failed", `Could not start the pipeline: ${exit.spawnError}`, {
        exitCode: null, error: { message: exit.spawnError, stage: null },
      });
    } else if (exit.exitCode === 0) {
      await this.finish(id, "succeeded", "Processing complete", { exitCode: 0 });
    } else {
      const message = err?.type === "error" ? err.message : `Pipeline exited with code ${exit.exitCode ?? exit.signal}`;
      await this.finish(id, "failed", message, {
        exitCode: exit.exitCode, error: { message, stage: err?.type === "error" ? err.stage : null },
      });
    }
  }

  private async finish(id: string, status: JobStatus, message: string, patch: Partial<Job>): Promise<Job> {
    this.cancelled.delete(id);
    const job = await this.deps.store.update(id, { ...patch, status, finishedAt: this.now().toISOString() });
    await this.record(id, this.jobEvent(status, message));
    return job;
  }

  private async record(id: string, event: PipelineEvent): Promise<StoredEvent> {
    const stored = await this.deps.store.appendEvent(id, event);
    this.deps.hub.publish(id, stored);
    return stored;
  }

  private jobEvent(status: JobStatus, message: string): PipelineEvent {
    return { v: 1, t: this.now().getTime() / 1000, type: "job", status, message };
  }

  private nativeLog(line: string): PipelineEvent {
    const message = line.length > MAX_NATIVE_LINE ? `${line.slice(0, MAX_NATIVE_LINE)}…` : line;
    return { v: 1, t: this.now().getTime() / 1000, type: "log", level: "native", logger: "stderr", message };
  }
}
