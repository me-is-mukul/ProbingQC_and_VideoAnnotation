import { describe, expect, it } from "vitest";

import { FRAME_COUNT, probeFramesCsv, probeResults } from "../../../../tests/fixtures/probe";
import { buildChartData, type ChartData } from "../results/chart-data";
import { ceilMicros, exactCommand, exactFilterGraph, fastCommand, fastConcatList, floorMicros, formatMicros, INLINE_GRAPH_LIMIT } from "./ffmpeg-command";
import { parseFramesCsv, type FramesTable } from "./frames-table";
import { fastAvailability, nextKeyframe, snapKeptToKeyframes } from "./keyframes";
import { activeCount, initialLines, lineOf, linesReducer, type LinesState } from "./lines";
import { buildProbeContext, buildProbePlan, keptRows, toSeconds, type ProbePlan } from "./plan";
import { planDocument, PLAN_FILE_SCHEMA } from "./plan-file";
import { probedMetrics } from "./probed-metrics";
import { chartSelection, isSelected, pointFrameRanges } from "./selection";
import { headline, summarizePlan, timelineLabel } from "./summary";

function table(csv = probeFramesCsv()): FramesTable {
  const parsed = parseFramesCsv(csv);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function setup(results = probeResults()) {
  const t = table();
  const ctx = buildProbeContext(results, t);
  if (!ctx.ok) throw new Error(ctx.error);
  return { results, table: t, ctx: ctx.value, charts: buildChartData(results) };
}

const on = (value: number, direction: "below" | "above" = "below") => ({ active: true, value, direction });

describe("frame table", () => {
  it("parses floats, empty cells (NaN) and Python booleans", () => {
    const t = table();
    expect(t.rows).toBe(10);
    expect([...t.frame]).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36]);
    expect(t.image.luminance[9]).toBe(100);
    expect(Array.from(t.hands!.left).slice(0, 4)).toEqual([1, 1, 0, 0]);
    expect(parseFramesCsv("frame,luminance,sharpness,blockiness,cast_offset,cast_factor,cast_hue_deg\n0,,1,1,1,1,\n").ok).toBe(true);
  });

  it("works without hand columns", () => {
    expect(table(probeFramesCsv(false)).hands).toBeNull();
  });

  it("rejects broken tables with a reason", () => {
    const header = "frame,luminance,sharpness,blockiness,cast_offset,cast_factor,cast_hue_deg";
    const cases: Array<[string, RegExp]> = [
      ["", /empty/],
      ["frame,luminance\n0,1\n", /no sharpness/],
      [`${header}\n0,1,1,1,1,1\n`, /fields/],
      [`${header}\n4,1,1,1,1,1,1\n4,1,1,1,1,1,1\n`, /increase/],
      [`${header}\nx,1,1,1,1,1,1\n`, /frame number/],
      [`${header}\n0,abc,1,1,1,1,1\n`, /non-numeric/],
    ];
    for (const [csv, reason] of cases) {
      const r = parseFramesCsv(csv);
      expect(r.ok, csv).toBe(false);
      if (!r.ok) expect(r.error).toMatch(reason);
    }
  });
});

describe("selection", () => {
  it("maps chart points to source frames (stride and tail)", () => {
    expect(pointFrameRanges([0, 4, 8, 12, 16, 20, 24, 28, 32, 36], 2, 40, 4)).toEqual([[0, 8], [8, 16], [16, 24], [24, 32], [32, 40]]);
    expect(pointFrameRanges([0, 4, 8], 2, 10, 4)).toEqual([[0, 8], [8, 10]]);       // tail clipped to the video
    expect(pointFrameRanges([0, 4, 8], 2, 0, 4)).toEqual([[0, 8], [8, 9]]);         // bad frame count: still covers the frame
    expect(pointFrameRanges([], 2, 10, 4)).toEqual([]);
  });

  it("selects strictly below/above and never selects a missing value", () => {
    expect(isSelected(1, { value: 2, direction: "below" })).toBe(true);
    expect(isSelected(2, { value: 2, direction: "below" })).toBe(false);
    expect(isSelected(3, { value: 2, direction: "above" })).toBe(true);
    expect(isSelected(null, { value: 2, direction: "below" })).toBe(false);
    expect(isSelected(Number.NaN, { value: 2, direction: "above" })).toBe(false);
  });

  it("merges neighbouring selected points into one frame range", () => {
    const ranges = [[0, 8], [8, 16], [16, 24]] as const;
    expect(chartSelection([1, 1, 5], { value: 2, direction: "below" }, ranges)).toEqual([[0, 16]]);
    expect(() => chartSelection([1], { value: 2, direction: "below" }, ranges)).toThrow();
  });
});

describe("lines reducer", () => {
  it("activates on move, keeps direction, resets", () => {
    let s: LinesState = initialLines;
    s = linesReducer(s, { type: "direction", id: "a", direction: "above" });
    expect(lineOf(s, "a")).toEqual({ active: false, value: 0, direction: "above" });
    expect(activeCount(s)).toBe(0);
    s = linesReducer(s, { type: "move", id: "a", value: 5 });
    expect(lineOf(s, "a")).toEqual({ active: true, value: 5, direction: "above" });
    expect(linesReducer(s, { type: "move", id: "a", value: 5 })).toBe(s);            // no-op keeps identity
    expect(linesReducer(s, { type: "move", id: "a", value: Number.NaN })).toBe(s);
    s = linesReducer(s, { type: "move", id: "b", value: 1 });
    expect(activeCount(s)).toBe(2);
    s = linesReducer(s, { type: "reset", id: "a" });
    expect(lineOf(s, "a").active).toBe(false);
    expect(linesReducer(s, { type: "resetAll" })).toEqual({});
  });
});

describe("keyframes", () => {
  it("decides whether lossless cuts are possible", () => {
    const r = probeResults();
    expect(fastAvailability(r).available).toBe(true);
    expect(fastAvailability({ ...r, keyframes: undefined }).available).toBe(false);
    expect(fastAvailability({ ...r, keyframes: null }).available).toBe(false);
    expect(fastAvailability({ ...r, keyframes: [] }).available).toBe(false);
    expect(fastAvailability({ ...r, video: { ...r.video, has_b_frames: 2 } })).toMatchObject({ available: false, reason: expect.stringMatching(/B-frames/) });
    expect(fastAvailability({ ...r, video: { ...r.video, has_b_frames: undefined } }).available).toBe(false);
  });

  it("starts kept parts on the next keyframe and drops parts without one", () => {
    expect(nextKeyframe([0, 10, 20], 0)).toBe(0);
    expect(nextKeyframe([0, 10, 20], 11)).toBe(20);
    expect(nextKeyframe([0, 10, 20], 21)).toBeNull();
    expect(snapKeptToKeyframes([[0, 8], [12, 25], [32, 40]], [0, 10, 20, 30])).toEqual([[0, 8], [20, 25]]);
    expect(snapKeptToKeyframes([[3, 5]], "all")).toEqual([[3, 5]]);
  });
});

describe("probe plan", () => {
  it("checks that the frame table matches the results", () => {
    const { results, table: t } = setup();
    expect(buildProbeContext({ ...results, report: { ...results.report, sampling: { ...results.report.sampling, frames_analyzed: 11 } } }, t).ok).toBe(false);
    expect(buildProbeContext({ ...results, frames_preview: { ...results.frames_preview, bucket_size: 3 } }, t).ok).toBe(false);
    expect(buildProbeContext({ ...results, video: { ...results.video, fps: 0 } }, t).ok).toBe(false);
  });

  it("removes nothing until a line is moved", () => {
    const { ctx, charts } = setup();
    const plan = buildProbePlan(ctx, charts, linesReducer(initialLines, { type: "direction", id: "luminance", direction: "above" }), "exact");
    expect(plan.removed).toEqual([]);
    expect(plan.kept).toEqual([[0, FRAME_COUNT]]);
    expect(plan.lines).toEqual([]);
  });

  it("selects the part of one chart below its line", () => {
    const { ctx, charts } = setup();
    const plan = buildProbePlan(ctx, charts, { luminance: on(50) }, "exact");
    expect(plan.removed).toEqual([[0, 16]]);        // points 15 and 35
    expect(plan.lines).toEqual([{ chartId: "luminance", title: "Luminance", direction: "below", value: 50, label: "50.0" }]);
  });

  it("intersects the selections of every line set", () => {
    const { ctx, charts } = setup();
    // luminance < 80 -> points 0-3 [0,32); sharpness < 300 -> points 1-3 [8,32); both -> [8,32)
    const plan = buildProbePlan(ctx, charts, { luminance: on(80), sharpness: on(300) }, "exact");
    expect(plan.requested).toEqual([[8, 32]]);
    expect(plan.removed).toEqual([[8, 32]]);
    expect(plan.kept).toEqual([[0, 8], [32, 40]]);
    expect(plan.removedFrames).toBe(24);
    expect(plan.keptFrames).toBe(16);
    expect(plan.extraFrames).toBe(0);
  });

  it("selects above the line when switched", () => {
    const { ctx, charts } = setup();
    expect(buildProbePlan(ctx, charts, { sharpness: on(300, "above") }, "exact").removed).toEqual([[0, 8], [32, 40]]);
  });

  it("fast mode keeps parts that start on keyframes and removes the rest", () => {
    const { ctx, charts } = setup();
    const plan = buildProbePlan(ctx, charts, { luminance: on(50) }, "fast");
    expect(plan.mode).toBe("fast");
    expect(plan.kept).toEqual([[20, 40]]);          // [16,40) starts on keyframe 20
    expect(plan.removed).toEqual([[0, 20]]);
    expect(plan.extraFrames).toBe(4);
    const both = buildProbePlan(ctx, charts, { luminance: on(80), sharpness: on(300) }, "fast");
    expect(both.kept).toEqual([[0, 8]]);            // [32,40) holds no keyframe
    expect(both.removed).toEqual([[8, 40]]);
  });

  it("falls back to exact when fast cuts are unavailable", () => {
    const { ctx, charts } = setup(probeResults({ keyframes: undefined }));
    const plan = buildProbePlan(ctx, charts, { luminance: on(50) }, "fast");
    expect(plan.mode).toBe("exact");
    expect(plan.removed).toEqual([[0, 16]]);
  });

  it("ignores charts without a probe line", () => {
    const { ctx, charts } = setup();
    const imu = charts.filter((c: ChartData) => !c.probe);
    expect(imu.map((c) => c.id)).toEqual(["accelerometer", "gyroscope"]);
    expect(buildProbePlan(ctx, charts, { accelerometer: on(1) }, "exact").removed).toEqual([]);
  });

  it("finds the analysed rows inside kept parts", () => {
    expect([...keptRows([0, 4, 8, 12, 16, 20, 24, 28, 32, 36], [[0, 8], [32, 40]])]).toEqual([0, 1, 8, 9]);
    expect([...keptRows([0, 4, 8], [[5, 6]])]).toEqual([]);
    expect(toSeconds([[30, 60]], 30)).toEqual([[1, 2]]);
  });
});

describe("metrics of the kept part", () => {
  it("recomputes image and hand figures from the kept rows, with the job's thresholds", () => {
    const { results, table: t } = setup();
    const m = probedMetrics(results, t, [[0, 8], [32, 40]]);   // rows 0, 1, 8, 9
    expect(m.rows).toBe(4);
    expect(m.image!.luminance.mean).toBe(55);                  // (10 + 20 + 90 + 100) / 4
    expect(m.image!.luminance.dark_frames_pct).toBe(50);       // 10 and 20 are < 40
    expect(m.image!.sharpness.blurry_frames_pct).toBe(0);      // blur_sharpness 150 from the job config
    expect(m.hands!.either_hand_pct).toBe(100);
  });

  it("returns null figures when the config or hand data is missing", () => {
    const { results, table: t } = setup();
    const noConfig = { ...results, report: { ...results.report, config: {} } };
    expect(probedMetrics(noConfig, t, [[0, 40]])).toMatchObject({ image: null, hands: null });
    expect(probedMetrics({ ...results, report: { ...results.report, hands: undefined } }, t, [[0, 40]]).hands).toBeNull();
  });
});

describe("ffmpeg commands", () => {
  const { ctx, charts } = setup();
  const plan = buildProbePlan(ctx, charts, { luminance: on(80), sharpness: on(300) }, "exact");
  const video = { file: "GX010191.MP4", hasAudio: true };

  it("formats microseconds and rounds frame times the safe way", () => {
    expect(formatMicros(3_336_666)).toBe("3.336666");
    expect(formatMicros(0)).toBe("0.000000");
    const ntsc = 29.97002997002997; // float(30000/1001) as written by Python
    expect(floorMicros(100, ntsc)).toBe(3_336_666);           // 3.3366666...: never after frame 100
    expect(ceilMicros(100, ntsc)).toBe(3_336_667);            // never before frame 100
    expect(ceilMicros(30, ntsc)).toBe(1_001_000);             // 1001000.0000000001 in floats: exact µs kept
    expect(floorMicros(180, ntsc)).toBe(6_006_000);
  });

  it("builds a trim/concat graph from the kept parts", () => {
    expect(exactFilterGraph(plan.kept, 40, 30, true)).toBe(
      "[0:v:0]split=2[v0][v1];[0:a:0]asplit=2[a0][a1];" +
      "[v0]trim=end_frame=8,setpts=PTS-STARTPTS[w0];[a0]atrim=end=0.266667,asetpts=PTS-STARTPTS[b0];" +
      "[v1]trim=start_frame=32,setpts=PTS-STARTPTS[w1];[a1]atrim=start=1.066667,asetpts=PTS-STARTPTS[b1];" +
      "[w0][b0][w1][b1]concat=n=2:v=1:a=1[v][a]",
    );
    expect(exactFilterGraph([[8, 32]], 40, 30, false)).toBe(
      "[0:v:0]split=1[v0];[v0]trim=start_frame=8:end_frame=32,setpts=PTS-STARTPTS[w0];[w0]concat=n=1:v=1:a=0[v]",
    );
  });

  it("writes the exact command inline when it is short", () => {
    const cmd = exactCommand(plan, video);
    if (!("command" in cmd)) throw new Error(cmd.unavailable);
    expect(cmd.command).toBe(
      `ffmpeg -i "GX010191.MP4" -filter_complex "${exactFilterGraph(plan.kept, 40, 30, true)}" -map "[v]" -map "[a]" ` +
      "-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart \"GX010191_probed.mp4\"",
    );
    expect(cmd.files).toEqual([]);
    expect(cmd.output).toBe("GX010191_probed.mp4");
  });

  it("drops the audio chain for silent videos and notes an unknown audio track", () => {
    const silent = exactCommand(plan, { ...video, hasAudio: false });
    if (!("command" in silent)) throw new Error(silent.unavailable);
    expect(silent.command).not.toMatch(/0:a|-c:a|\[a\]/);
    const unknown = exactCommand(plan, { ...video, hasAudio: null });
    if (!("command" in unknown)) throw new Error(unknown.unavailable);
    expect(unknown.command).toMatch(/\[0:a:0\]asplit/);
    expect(unknown.notes.join(" ")).toMatch(/assumes it does/);
  });

  it("moves a long graph into a script file read with -/filter_complex", () => {
    const kept = Array.from({ length: 60 }, (_, i) => [i * 10, i * 10 + 5] as const);
    const long: ProbePlan = { ...plan, kept, frameCount: 600, removedFrames: 300, keptFrames: 300 };
    expect(exactFilterGraph(kept, 600, 30, true).length).toBeGreaterThan(INLINE_GRAPH_LIMIT);
    const cmd = exactCommand(long, video);
    if (!("command" in cmd)) throw new Error(cmd.unavailable);
    expect(cmd.command).toContain('-/filter_complex "GX010191_probe_filter.txt"');
    expect(cmd.files).toHaveLength(1);
    expect(cmd.files[0]!.name).toBe("GX010191_probe_filter.txt");
    expect(cmd.files[0]!.content.split(";\n")).toHaveLength(2 + 60 * 2 + 1);
    expect(cmd.notes[0]).toMatch(/ffmpeg 7\.0/);
  });

  it("uses a placeholder input when the file name is unsafe in shells", () => {
    const cmd = exactCommand(plan, { file: "clip $1.mp4", hasAudio: true });
    if (!("command" in cmd)) throw new Error(cmd.unavailable);
    expect(cmd.command).toContain('-i "input.mp4"');
    expect(cmd.notes[0]).toMatch(/Rename the video to input\.mp4/);
    expect(cmd.output).toBe("clip_1_probed.mp4");
  });

  it("refuses when nothing or everything would be removed", () => {
    const none = buildProbePlan(ctx, charts, {}, "exact");
    expect(exactCommand(none, video)).toEqual({ unavailable: expect.stringMatching(/Nothing is removed/) });
    const all = buildProbePlan(ctx, charts, { luminance: on(255) }, "exact");
    expect(exactCommand(all, video)).toEqual({ unavailable: expect.stringMatching(/Every frame/) });
  });

  it("lists kept parts for the concat demuxer (lossless)", () => {
    const fast = buildProbePlan(ctx, charts, { luminance: on(50) }, "fast");
    expect(fastConcatList(fast, "GX010191.MP4")).toBe("ffconcat version 1.0\nfile 'GX010191.MP4'\ninpoint 0.666667\n");
    const ntsc: ProbePlan = { ...fast, kept: [[0, 100], [180, 300]], frameCount: 600, fps: 29.97002997002997 };
    expect(fastConcatList(ntsc, "it's.mp4")).toBe(
      "ffconcat version 1.0\nfile 'it'\\''s.mp4'\noutpoint 3.336666\nfile 'it'\\''s.mp4'\ninpoint 6.006000\noutpoint 10.010000\n",
    );
    const cmd = fastCommand(fast, video);
    if (!("command" in cmd)) throw new Error(cmd.unavailable);
    expect(cmd.command).toBe('ffmpeg -f concat -safe 0 -i "GX010191_probe.ffconcat" -map 0:v:0 -map "0:a:0?" -c copy -movflags +faststart "GX010191_probed.mp4"');
    expect(cmd.files[0]!.name).toBe("GX010191_probe.ffconcat");
    expect(fastCommand(plan, video)).toEqual({ unavailable: expect.any(String) }); // an exact plan
  });
});

describe("summary and plan file", () => {
  const { ctx, charts } = setup();
  const plan = buildProbePlan(ctx, charts, { luminance: on(80), sharpness: on(300) }, "exact");

  it("summarises what is removed", () => {
    const s = summarizePlan(plan);
    expect(s.removedPct).toBe(60);
    expect(s.parts).toBe(1);
    expect(s.removedS).toBeCloseTo(0.8, 12);
    expect(s.keptS).toBeCloseTo(16 / 30, 12);
    expect(s.removedSeconds).toEqual([[8 / 30, 32 / 30]]);
    expect(s.extraSeconds).toEqual([]);
    expect(headline(s)).toBe("Removing 800 ms of 1.3 s (60.0%) · 1 part");
    expect(timelineLabel(s)).toMatch(/removes 800 ms \(60\.0%\) in 1 part\./);
    expect(headline(summarizePlan(buildProbePlan(ctx, charts, {}, "exact")))).toBe("Nothing selected yet");
  });

  it("marks what fast mode removes only for keyframes", () => {
    const s = summarizePlan(buildProbePlan(ctx, charts, { luminance: on(50) }, "fast"));
    expect(s.extraSeconds).toEqual([[16 / 30, 20 / 30]]);
    expect(s.extraS).toBeCloseTo(4 / 30, 12);
  });

  it("writes a reproducible plan document", () => {
    const doc = planDocument({ plan, videoFile: "GX010191.MP4", jobId: "j", createdAt: new Date("2026-11-10T00:00:00Z") });
    expect(doc.schema).toBe(PLAN_FILE_SCHEMA);
    expect(doc.lines).toEqual([
      { chart: "luminance", title: "Luminance", direction: "below", threshold: 80 },
      { chart: "sharpness", title: "Sharpness", direction: "below", threshold: 300 },
    ]);
    expect(doc.removed).toEqual([{ start_frame: 8, end_frame: 32, start_s: 8 / 30, end_s: 32 / 30 }]);
    expect(doc.totals).toMatchObject({ removed_frames: 24, kept_frames: 16 });
  });
});

