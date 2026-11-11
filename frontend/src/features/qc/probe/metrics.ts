/**
 * The report's image and hand metrics, recomputed for the frames a probe keeps. Ports of
 * ImageQualityAnalyzer.summarize (qc/analyzers/image.py) and compute_hand_metrics
 * (qc/hands/metrics.py, its HOI block in ./hoi.ts); probe-parity.json holds the Python
 * outputs they must reproduce.
 *
 * The probed video is the kept frames played back to back, so run-based numbers (grasps,
 * tracking losses, gaps) are computed on the concatenated rows, exactly as Python would
 * compute them on the cut video's frame table.
 */

import type { GraspDuration, HandMetrics, TechnicalReport } from "@/lib/shared/types";

import { hoiMetrics } from "./hoi";
import { mean, pairwiseSum, pyRound, pyRoundInt } from "./numeric";
import { and, circularMeanDeg, dropShort, fillGaps, longestRun, not, or, pct, runs, summarize } from "./stats";

export interface ImageThresholds {
  dark_luma: number;
  bright_luma: number;
  blur_sharpness: number;
  cast_factor: number;
}

export interface HandThresholds {
  min_loss_s: number;
  grasp_merge_gap_s: number;
  grasp_min_duration_s: number;
}

export interface ImageColumns {
  luminance: ArrayLike<number>;
  sharpness: ArrayLike<number>;
  blockiness: ArrayLike<number>;
  cast_offset: ArrayLike<number>;
  cast_factor: ArrayLike<number>;
  cast_hue_deg: ArrayLike<number>;
}

/** 0/1 per analysed frame. */
export interface HandColumns {
  left: ArrayLike<number>;
  right: ArrayLike<number>;
  left_contact: ArrayLike<number>;
  right_contact: ArrayLike<number>;
}

export type ImageMetrics = Pick<TechnicalReport, "luminance" | "sharpness" | "blockiness" | "colour_cast">;

/** Values of `column` at the given row indices (the kept rows, in order). */
export function take(column: ArrayLike<number>, rows: ArrayLike<number>): Float64Array {
  const out = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i += 1) out[i] = column[rows[i]!]!;
  return out;
}

function countWhere(values: ArrayLike<number>, test: (v: number) => boolean): Uint8Array {
  return Uint8Array.from({ length: values.length }, (_, i) => (test(values[i]!) ? 1 : 0));
}

/** ImageQualityAnalyzer.summarize on the given rows. */
export function imageMetrics(cols: ImageColumns, rows: ArrayLike<number>, c: ImageThresholds): ImageMetrics {
  const lum = take(cols.luminance, rows);
  const sharp = take(cols.sharpness, rows);
  const factor = take(cols.cast_factor, rows);
  const hue = take(cols.cast_hue_deg, rows);
  // NaN comparisons are false, as in pandas.
  const cast = countWhere(factor, (v) => v > c.cast_factor);
  const castHues = hue.filter((_, i) => cast[i] === 1);
  const h = circularMeanDeg(castHues);
  return {
    luminance: {
      ...summarize(lum),
      dark_frames_pct: pct(countWhere(lum, (v) => v < c.dark_luma)),
      bright_frames_pct: pct(countWhere(lum, (v) => v > c.bright_luma)),
    },
    sharpness: { ...summarize(sharp), blurry_frames_pct: pct(countWhere(sharp, (v) => v < c.blur_sharpness)) },
    blockiness: summarize(take(cols.blockiness, rows)),
    colour_cast: {
      offset: summarize(take(cols.cast_offset, rows)),
      factor: summarize(factor),
      cast_frames_pct: pct(cast),
      cast_hue_deg: h === null || Number.isNaN(h) ? null : pyRound(h, 1),
    },
  };
}

// ---------------------------------------------------------------- hands (qc/hands/metrics.py)

export function secondsToFrames(seconds: number, dt: number): number {
  return Math.max(pyRoundInt(seconds / dt), 0);
}

export function trackingLosses(present: ArrayLike<number>, minGap: number): number {
  return runs(not(present)).filter(([start, end]) => start > 0 && end - start >= minGap).length;
}

export function longestGapS(present: ArrayLike<number>, dt: number): number {
  return longestRun(not(present)) * dt;
}

export function graspEpisodes(contact: ArrayLike<number>, dt: number, c: HandThresholds): { episodes: Float64Array; mask: Uint8Array } {
  let m = fillGaps(contact, secondsToFrames(c.grasp_merge_gap_s, dt));
  m = dropShort(m, Math.max(secondsToFrames(c.grasp_min_duration_s, dt), 1));
  return { episodes: Float64Array.from(runs(m), ([a, b]) => (b - a) * dt), mask: m };
}

export function durationSummary(episodes: Float64Array): GraspDuration {
  if (episodes.length === 0) return { total_s: 0, mean_s: null, median_s: null, max_s: null };
  const sorted = Float64Array.from(episodes).sort();
  const n = sorted.length;
  // np.median: middle value, or the mean of the two middle values
  const median = n % 2 ? sorted[(n - 1) / 2]! : mean([sorted[n / 2 - 1]!, sorted[n / 2]!]);
  return {
    total_s: pyRound(pairwiseSum(episodes), 2),
    mean_s: pyRound(mean(episodes), 2),
    median_s: pyRound(median, 2),
    max_s: pyRound(sorted[n - 1]!, 2),
  };
}

/** compute_hand_metrics on the given rows. Contact only counts while that hand is detected. */
export function handMetrics(cols: HandColumns, rows: ArrayLike<number>, dt: number, c: HandThresholds): HandMetrics {
  const left = take(cols.left, rows);
  const right = take(cols.right, rows);
  const either = or(left, right);
  const both = and(left, right);
  const minGap = Math.max(secondsToFrames(c.min_loss_s, dt), 1);
  const l = graspEpisodes(and(take(cols.left_contact, rows), left), dt, c);
  const r = graspEpisodes(and(take(cols.right_contact, rows), right), dt, c);
  const episodes = new Float64Array([...l.episodes, ...r.episodes]);
  const perHand = (present: ArrayLike<number>, eps: Float64Array) => ({
    tracking_losses: trackingLosses(present, minGap),
    grasp_count: eps.length,
    grasp_duration: durationSummary(eps),
  });
  return {
    either_hand_pct: pct(either),
    both_hands_pct: pct(both),
    left_hand_pct: pct(left),
    right_hand_pct: pct(right),
    HOI_pct: pct(or(l.mask, r.mask)),
    tracking_losses: trackingLosses(either, minGap),
    untracked_pct: pct(not(either)),
    grasp_count: episodes.length,
    grasp_duration: durationSummary(episodes),
    longest_hand_gap: pyRound(longestGapS(either, dt), 2),
    per_hand: { left: perHand(left, l.episodes), right: perHand(right, r.episodes) },
    hoi: hoiMetrics(left, right, l.mask, r.mask, episodes.length, dt),
  };
}
