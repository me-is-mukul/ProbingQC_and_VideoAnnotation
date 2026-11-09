/** Test doubles and temp-dir helpers for server modules. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DataPaths } from "@/lib/server/data-paths";
import { EventHub } from "@/lib/server/jobs/event-hub";
import { JobQueue } from "@/lib/server/jobs/job-queue";
import { JobService } from "@/lib/server/jobs/job-service";
import { FileJobStore } from "@/lib/server/jobs/job-store";
import type { Command } from "@/lib/server/jobs/pipeline-command";
import type { ProcessExit, ProcessHandle, ProcessHandlers, ProcessRunner } from "@/lib/server/jobs/process-runner";
import { UploadStore } from "@/lib/server/uploads/upload-store";

export async function tempDir(prefix = "pqc-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export function streamOf(...chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? encoder.encode(c) : c);
      controller.close();
    },
  });
}

/** One scripted process: the test pushes stdout/stderr lines and decides the exit. */
export class FakeProcess implements ProcessHandle {
  readonly pid = 1234;
  killed = false;
  private resolveExit!: (exit: ProcessExit) => void;
  readonly exited = new Promise<ProcessExit>((r) => (this.resolveExit = r));

  constructor(
    readonly command: Command,
    private readonly handlers: ProcessHandlers,
  ) {}

  stdout(...lines: Array<string | object>) {
    for (const l of lines) this.handlers.onStdoutLine(typeof l === "string" ? l : JSON.stringify(l));
  }

  stderr(line: string) {
    this.handlers.onStderrLine(line);
  }

  exit(exitCode: number | null, extra: Partial<ProcessExit> = {}) {
    this.resolveExit({ exitCode, signal: null, ...extra });
  }

  kill() {
    this.killed = true;
    this.exit(null, { signal: "SIGTERM" });
  }
}

export class FakeRunner implements ProcessRunner {
  readonly started: FakeProcess[] = [];

  start(command: Command, handlers: ProcessHandlers): ProcessHandle {
    const p = new FakeProcess(command, handlers);
    this.started.push(p);
    return p;
  }

  get last(): FakeProcess {
    const p = this.started.at(-1);
    if (!p) throw new Error("no process started");
    return p;
  }
}

export async function makeJobService(opts: { concurrency?: number } = {}) {
  const dataDir = await tempDir();
  const paths = new DataPaths(dataDir);
  const store = new FileJobStore(paths);
  const hub = new EventHub();
  const runner = new FakeRunner();
  const uploads = new UploadStore(paths, 10 * 1024 * 1024);
  let n = 0;
  const service = new JobService({
    store, hub, runner, uploads, paths,
    queue: new JobQueue(opts.concurrency ?? 1),
    pythonBin: "/venv/bin/python",
    pipelineRoot: "/repo",
    now: () => new Date(Date.UTC(2026, 10, 9, 12, 0, n++)),
  });
  return { dataDir, paths, store, hub, runner, uploads, service };
}

export const pyEvent = (type: string, fields: Record<string, unknown>) => ({ v: 1, t: 1_794_213_200, type, ...fields });
