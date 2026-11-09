/**
 * End-to-end contract test: the real Python pipeline, spawned by the real JobService, on a
 * 2-second synthetic video. Proves that every line Python prints parses as an event and that
 * results.json matches the TypeScript types the dashboard reads.
 *
 * Skipped automatically when the Python venv or FFmpeg is not available.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { defaultPythonBin } from "@/lib/server/config";
import { DataPaths } from "@/lib/server/data-paths";
import { EventHub } from "@/lib/server/jobs/event-hub";
import { JobQueue } from "@/lib/server/jobs/job-queue";
import { JobService } from "@/lib/server/jobs/job-service";
import { FileJobStore } from "@/lib/server/jobs/job-store";
import { SpawnProcessRunner } from "@/lib/server/jobs/process-runner";
import { UploadStore } from "@/lib/server/uploads/upload-store";
import { parseEventLine } from "@/lib/shared/events";
import type { QCResults } from "@/lib/shared/types";

import { tempDir } from "../helpers/server";

const pipelineRoot = path.resolve(__dirname, "../../..");
const pythonBin = process.env.PYTHON_BIN ?? defaultPythonBin(pipelineRoot, process.platform);

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const available = fs.existsSync(pythonBin) && hasFfmpeg();

describe.skipIf(!available)("Python pipeline integration", () => {
  let dataDir: string;
  let video: string;

  beforeAll(async () => {
    dataDir = await tempDir("pqc-int-");
    video = path.join(dataDir, "synthetic.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  });

  afterAll(async () => {
    await fsp.rm(dataDir, { recursive: true, force: true });
  });

  it("emits only valid events on stdout (contract)", () => {
    const jobDir = path.join(dataDir, "raw-job");
    const out = execFileSync(pythonBin, ["-m", "probing_qc.cli.job", "--job-dir", jobDir, "--video", video, "--no-hands", "--stride", "6"], {
      cwd: pipelineRoot, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    const lines = out.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) expect(parseEventLine(line), line).not.toBeNull();
    expect(parseEventLine(lines.at(-1)!)?.type).toBe("result");
  }, 120_000);

  it("runs a full upload job through JobService and produces renderable results", async () => {
    const paths = new DataPaths(dataDir);
    const uploads = new UploadStore(paths, 1024 ** 3);
    const service = new JobService({
      store: new FileJobStore(paths), hub: new EventHub(), queue: new JobQueue(1), runner: new SpawnProcessRunner(),
      uploads, paths, pythonBin, pipelineRoot,
    });
    const body = fs.readFileSync(video);
    const upload = await uploads.save(new Blob([body]).stream(), "synthetic.mp4");
    const job = await service.create({ source: { kind: "upload", uploadId: upload.uploadId }, options: { hands: false, imu: true, frameStride: 6 } });

    await vi.waitFor(async () => expect((await service.get(job.id))?.status).toMatch(/succeeded|failed/), { timeout: 110_000, interval: 250 });
    const finished = await service.get(job.id);
    const events = await service.events(job.id);
    expect(finished?.status, JSON.stringify(events.slice(-3))).toBe("succeeded");

    const stages = events.filter((e) => e.type === "stage").map((e) => e.type === "stage" && `${e.stage}:${e.status}`);
    expect(stages).toEqual(["download:skip", "probe:start", "probe:done", "imu:skip", "qc:start", "qc:done", "results:start", "results:done"]);

    const results = JSON.parse(await fsp.readFile(await service.resultsPath(job.id), "utf8")) as QCResults;
    expect(results.schema_version).toBe("1.0");
    expect(results.video.codec).toBe("h264");
    expect(results.report.sampling.frames_analyzed).toBe(10);
    expect(results.frames_preview.t).toHaveLength(results.frames_preview.points);
    expect(results.imu).toBeNull();
  }, 120_000);
});
