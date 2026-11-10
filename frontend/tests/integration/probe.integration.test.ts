/**
 * End-to-end probing check with the real tools: the Python job analyses a 4 s clip
 * (H.264 without B-frames, keyframe every 30 frames, AAC audio), the browser modules build
 * a plan from its results and frame table, and the generated ffmpeg commands are run
 * exactly as a user would paste them. The cut videos must contain exactly the frames the
 * plan keeps, and (lossless mode) those frames must be bit-identical to the source frames.
 *
 * Skipped automatically when the Python venv or FFmpeg is not available.
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { exactCommand, fastCommand } from "@/features/qc/probe/ffmpeg-command";
import { parseFramesCsv, type FramesTable } from "@/features/qc/probe/frames-table";
import { snapKeptToKeyframes } from "@/features/qc/probe/keyframes";
import type { LinesState } from "@/features/qc/probe/lines";
import { buildProbeContext, buildProbePlan, type ProbeContext, type ProbePlan } from "@/features/qc/probe/plan";
import { probedMetrics } from "@/features/qc/probe/probed-metrics";
import { buildChartData } from "@/features/qc/results/chart-data";
import { defaultPythonBin } from "@/lib/server/config";
import { complement, totalLength } from "@/lib/shared/probe/intervals";
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

function countFrames(file: string, stream: "v" | "a"): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", `${stream}:0`, "-count_frames",
    "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(out.trim());
}

function duration(file: string, stream: "v" | "a"): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", `${stream}:0`,
    "-show_entries", "stream=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(out.trim());
}

function frameMd5(file: string, n: number): string {
  const out = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v:0", "-vf", `select=eq(n\\,${n})`,
    "-fps_mode", "passthrough", "-f", "framemd5", "-"], { encoding: "utf8" });
  return out.split(/\r?\n/).filter((l) => l && !l.startsWith("#")).at(-1)!.split(",").at(-1)!.trim();
}

describe.skipIf(!available)("probing end to end (Python job -> plan -> ffmpeg)", () => {
  let dir: string;
  let results: QCResults;
  let table: FramesTable;
  let ctx: ProbeContext;

  beforeAll(async () => {
    dir = await tempDir("pqc-probe-");
    const video = path.join(dir, "clip.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-bf", "0", "-g", "30",
      "-keyint_min", "30", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video]);
    const jobDir = path.join(dir, "job");
    execFileSync(pythonBin, ["-m", "probing_qc.cli.job", "--job-dir", jobDir, "--video", video, "--no-hands", "--stride", "1"], {
      cwd: pipelineRoot, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    results = JSON.parse(await fsp.readFile(path.join(jobDir, "results.json"), "utf8")) as QCResults;
    const parsed = parseFramesCsv(await fsp.readFile(path.join(jobDir, results.files.frames_csv), "utf8"));
    if (!parsed.ok) throw new Error(parsed.error);
    table = parsed.value;
    const built = buildProbeContext(results, table);
    if (!built.ok) throw new Error(built.error);
    ctx = built.value;
  }, 120_000);

  afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("reads the keyframe index and stream flags the fast mode needs", () => {
    expect(results.keyframes).toEqual([0, 30, 60, 90]);
    expect(results.video.has_audio).toBe(true);
    expect(results.video.has_b_frames).toBe(0);
    expect(ctx.fast.available).toBe(true);
    expect(ctx.frameCount).toBe(120);
  });

  it("recomputes the report's figures when everything is kept", () => {
    const m = probedMetrics(results, table, [[0, ctx.frameCount]]);
    const t = results.report.technical;
    expect(m.rows).toBe(120);
    // The CSV stores 4 decimals, the report was computed before rounding: equal at display precision.
    expect(m.image!.luminance.mean!).toBeCloseTo(t.luminance.mean!, 2);
    expect(m.image!.sharpness.p50!).toBeCloseTo(t.sharpness.p50!, 1);
    expect(m.image!.blockiness.mean!).toBeCloseTo(t.blockiness.mean!, 3);
    expect(m.image!.luminance.dark_frames_pct).toBe(t.luminance.dark_frames_pct);
    expect(m.image!.sharpness.blurry_frames_pct).toBe(t.sharpness.blurry_frames_pct);
    expect(m.image!.colour_cast.cast_frames_pct).toBe(t.colour_cast.cast_frames_pct);
  });

  it("cuts exactly the planned frames with the exact (re-encode) command", () => {
    const charts = buildChartData(results);
    const lum = charts.find((c) => c.id === "luminance")!;
    const values = lum.series[0]!.values.filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
    const lines: LinesState = { luminance: { active: true, value: values[Math.floor(values.length / 2)]!, direction: "below" } };
    const plan = buildProbePlan(ctx, charts, lines, "exact");
    expect(plan.removedFrames).toBeGreaterThan(0);
    expect(plan.keptFrames).toBeGreaterThan(0);
    expect(totalLength(plan.removed) + totalLength(plan.kept)).toBe(120);

    const cmd = exactCommand(plan, { file: results.video.file, hasAudio: results.video.has_audio ?? null });
    if (!("command" in cmd)) throw new Error(cmd.unavailable);
    for (const f of cmd.files) fs.writeFileSync(path.join(dir, f.name), f.content);
    const out = path.join(dir, cmd.output);
    fs.rmSync(out, { force: true });
    execSync(cmd.command, { cwd: dir, stdio: "pipe" });
    expect(countFrames(out, "v")).toBe(plan.keptFrames);
    expect(duration(out, "a")).toBeCloseTo(plan.keptFrames / ctx.fps, 1);
  }, 120_000);

  it.each([
    ["inline graph", [[30, 60]]],
    ["graph in a script file (-/filter_complex)", Array.from({ length: 30 }, (_, i) => [i * 4 + 2, i * 4 + 4])],
  ] as const)("exact command with an %s keeps exactly the planned frames", (_name, removedList) => {
    const removed = removedList.map(([a, b]) => [a, b] as const);
    const kept = complement(removed, 0, 120);
    const keptFrames = totalLength(kept);
    const plan: ProbePlan = {
      mode: "exact", lines: [], requested: removed, removed, kept,
      removedFrames: 120 - keptFrames, keptFrames, extraFrames: 0, frameCount: 120, fps: ctx.fps,
    };
    const cmd = exactCommand(plan, { file: results.video.file, hasAudio: true });
    if (!("command" in cmd)) throw new Error(cmd.unavailable);
    expect(cmd.files.length).toBe(removed.length > 1 ? 1 : 0);
    for (const f of cmd.files) fs.writeFileSync(path.join(dir, f.name), f.content);
    const out = path.join(dir, cmd.output);
    fs.rmSync(out, { force: true });
    execSync(cmd.command, { cwd: dir, stdio: "pipe" });
    expect(countFrames(out, "v")).toBe(keptFrames);
    expect(duration(out, "a")).toBeCloseTo(keptFrames / ctx.fps, 1);
  }, 120_000);

  it("produces bit-identical kept frames with the fast (lossless) command", () => {
    // Lines asking to remove frames [20, 45) and [70, 100). Kept parts must start on a keyframe:
    // [45, 70) starts at keyframe 60, and [100, 120) holds no keyframe, so it is removed too.
    const requested = [[20, 45], [70, 100]] as const;
    const kept = snapKeptToKeyframes(complement(requested, 0, 120), [0, 30, 60, 90]);
    expect(kept).toEqual([[0, 20], [60, 70]]);
    const plan: ProbePlan = {
      mode: "fast", lines: [], requested: [...requested], kept, removed: complement(kept, 0, 120),
      removedFrames: 90, keptFrames: 30, extraFrames: 35, frameCount: 120, fps: ctx.fps,
    };
    const cmd = fastCommand(plan, { file: results.video.file, hasAudio: true });
    if (!("command" in cmd)) throw new Error(cmd.unavailable);
    for (const f of cmd.files) fs.writeFileSync(path.join(dir, f.name), f.content);
    const out = path.join(dir, cmd.output);
    fs.rmSync(out, { force: true }); // the command never overwrites (no -y); the exact test wrote this name
    execSync(cmd.command, { cwd: dir, stdio: "pipe" });
    const src = path.join(dir, results.video.file);
    expect(countFrames(out, "v")).toBe(30);
    expect(frameMd5(out, 0)).toBe(frameMd5(src, 0));
    expect(frameMd5(out, 19)).toBe(frameMd5(src, 19));
    expect(frameMd5(out, 20)).toBe(frameMd5(src, 60));   // first frame after the first cut
    expect(frameMd5(out, 29)).toBe(frameMd5(src, 69));
  }, 120_000);
});
