/**
 * The probe plan: from the lines on the charts to the exact frames the command removes.
 *
 *   selection(chart) = frames whose chart point is below/above that chart's line
 *   requested        = selection(chart 1) ∩ selection(chart 2) ∩ ...   (active lines only)
 *   removed          = requested                                         (exact mode)
 *                    = [0, frames) − keyframe-aligned kept parts         (fast mode, ⊇ requested)
 *
 * Everything is in source frame numbers (integers), so there is no float rounding until a
 * time is written into a command. Time outside the analysed window has no chart data and
 * is never selected, so it is always kept.
 */

import { complement, intersectAll, mapBounds, totalLength, type Interval } from "@/lib/shared/probe/intervals";
import { err, ok, type Result } from "@/lib/shared/result";
import type { QCResults } from "@/lib/shared/types";

import type { ChartData } from "../results/chart-data";
import type { FramesTable } from "./frames-table";
import { fastAvailability, snapKeptToKeyframes, type FastAvailability } from "./keyframes";
import { lineOf, type LinesState } from "./lines";
import { chartSelection, pointFrameRanges, type ProbeDirection } from "./selection";

export type CutMode = "exact" | "fast";

export interface ProbeContext {
  fps: number;
  /** Frames in the video (container count, raised to cover every analysed frame). */
  frameCount: number;
  /** Source frame range of every chart point (preview bucket). */
  pointRanges: Interval[];
  /** [first analysed frame, end of the last point): the only time lines can select. */
  analysed: Interval;
  /** Source frame number of each analysed row. */
  rowFrames: Int32Array;
  fast: FastAvailability;
}

/** Check that the frame table belongs to these results and derive the frame geometry. */
export function buildProbeContext(r: QCResults, table: FramesTable): Result<ProbeContext> {
  const s = r.report.sampling;
  const p = r.frames_preview;
  if (table.rows === 0) return err("The frame table has no rows.");
  if (table.rows !== s.frames_analyzed) {
    return err(`The frame table has ${table.rows} rows but the report analysed ${s.frames_analyzed} frames.`);
  }
  if (!(p.bucket_size >= 1) || Math.ceil(table.rows / p.bucket_size) !== p.t.length) {
    return err("The chart data doesn't match the frame table (bucket size).");
  }
  if (!(r.video.fps > 0)) return err("The video has no usable frame rate.");
  const last = table.frame[table.rows - 1]!;
  const frameCount = Math.max(r.video.frame_count, last + 1);
  const pointRanges = pointFrameRanges(table.frame, p.bucket_size, frameCount, s.frame_stride);
  return ok({
    fps: r.video.fps,
    frameCount,
    pointRanges,
    analysed: [pointRanges[0]![0], pointRanges[pointRanges.length - 1]![1]],
    rowFrames: table.frame,
    fast: fastAvailability(r),
  });
}

export interface ActiveLine {
  chartId: string;
  title: string;
  direction: ProbeDirection;
  value: number;
  /** The threshold as the chart formats it. */
  label: string;
}

export interface ProbePlan {
  /** The mode actually used (fast falls back to exact when unavailable). */
  mode: CutMode;
  lines: ActiveLine[];
  /** Frames the lines select (the intersection). */
  requested: Interval[];
  /** Frames the command removes. Equal to `requested` in exact mode. */
  removed: Interval[];
  /** Frames the command keeps (complement of `removed`). */
  kept: Interval[];
  removedFrames: number;
  keptFrames: number;
  /** Frames removed only to start kept parts on keyframes (fast mode). */
  extraFrames: number;
  frameCount: number;
  fps: number;
}

export function buildProbePlan(ctx: ProbeContext, charts: readonly ChartData[], lines: LinesState, mode: CutMode): ProbePlan {
  const active = charts.filter((c) => c.probe && lineOf(lines, c.id).active);
  const selections = active.map((c) => chartSelection(c.series[0]!.values, lineOf(lines, c.id), ctx.pointRanges));
  const requested = intersectAll(selections);
  const exactKept = complement(requested, 0, ctx.frameCount);

  const useFast = mode === "fast" && ctx.fast.available && requested.length > 0;
  const kept = useFast && ctx.fast.available ? snapKeptToKeyframes(exactKept, ctx.fast.keyframes) : exactKept;
  const removed = useFast ? complement(kept, 0, ctx.frameCount) : requested;
  const removedFrames = totalLength(removed);

  return {
    mode: mode === "fast" && ctx.fast.available ? "fast" : "exact",
    lines: active.map((c) => {
      const l = lineOf(lines, c.id);
      return { chartId: c.id, title: c.title, direction: l.direction, value: l.value, label: c.formatValue(l.value) };
    }),
    requested,
    removed,
    kept,
    removedFrames,
    keptFrames: ctx.frameCount - removedFrames,
    extraFrames: removedFrames - totalLength(requested),
    frameCount: ctx.frameCount,
    fps: ctx.fps,
  };
}

/** Frame intervals -> seconds on the video timeline (frame n starts at n / fps). */
export function toSeconds(set: readonly Interval[], fps: number): Interval[] {
  return mapBounds(set, (f) => f / fps);
}

/** Row indices (ascending) of the analysed frames that fall inside `kept`. */
export function keptRows(rowFrames: ArrayLike<number>, kept: readonly Interval[]): Int32Array {
  const rows: number[] = [];
  let k = 0;
  for (let i = 0; i < rowFrames.length; i += 1) {
    const f = rowFrames[i]!;
    while (k < kept.length && kept[k]![1] <= f) k += 1;
    if (k < kept.length && f >= kept[k]![0]) rows.push(i);
  }
  return Int32Array.from(rows);
}
