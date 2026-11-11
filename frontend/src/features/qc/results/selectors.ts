/**
 * results.json -> view models for the dashboard. Pure functions, no React, so every
 * number the UI shows can be unit-tested against a fixture.
 */

import type { Status } from "@/components/ui/StatusBadge";
import {
  formatBitrate, formatBytes, formatDuration, formatNumber, formatPercent, formatTimecode,
} from "@/lib/shared/format";
import type { Distribution, HandMetrics, QCReport, QCResults, SeriesPreview, TechnicalReport } from "@/lib/shared/types";

export interface Tile {
  label: string;
  value: string;
  detail?: string;
}

export interface Flag {
  status: Status;
  label: string;
  detail?: string;
}

export interface MeterView {
  label: string;
  value: number | null;
  note?: string;
}

/** A column of a downsampled preview as numbers/nulls (missing column -> all null). */
export function column(preview: SeriesPreview, key: string): Array<number | null> {
  const values = preview[key];
  return Array.isArray(values) ? values : new Array<number | null>(preview.t.length).fill(null);
}

/** Multiply every finite value (e.g. 0-1 fractions -> %); nulls stay null. */
export function scale(values: ReadonlyArray<number | null>, factor: number): Array<number | null> {
  return values.map((v) => (typeof v === "number" ? v * factor : null));
}

/** Median spacing of a time axis in seconds (null for fewer than two finite points). */
export function medianStep(t: ReadonlyArray<number | null>): number | null {
  const steps: number[] = [];
  for (let i = 1; i < t.length; i += 1) {
    const a = t[i - 1];
    const b = t[i];
    if (typeof a === "number" && typeof b === "number" && b > a) steps.push(b - a);
  }
  if (!steps.length) return null;
  steps.sort((x, y) => x - y);
  return steps[Math.floor(steps.length / 2)]!;
}

/** Points that span `seconds` on axis `t` (at least 1, i.e. no smoothing). */
export function windowFor(t: ReadonlyArray<number | null>, seconds: number): number {
  const step = medianStep(t);
  return step === null ? 1 : Math.max(1, Math.round(seconds / step));
}

/**
 * Centred moving average over `window` points, ignoring nulls (a point whose whole window
 * is null stays null). Turns per-frame 0/1 flags into a readable "share of frames" line.
 */
export function rollingMean(values: ReadonlyArray<number | null>, window: number): Array<number | null> {
  if (window <= 1) return [...values];
  const half = Math.floor(window / 2);
  const out: Array<number | null> = [];
  let sum = 0;
  let count = 0;
  // sliding window [lo, hi]
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < values.length; i += 1) {
    const wantLo = Math.max(0, i - half);
    const wantHi = Math.min(values.length - 1, i - half + window - 1);
    while (hi < wantHi) {
      hi += 1;
      const v = values[hi];
      if (typeof v === "number") {
        sum += v;
        count += 1;
      }
    }
    while (lo < wantLo) {
      const v = values[lo];
      if (typeof v === "number") {
        sum -= v;
        count -= 1;
      }
      lo += 1;
    }
    out.push(count ? sum / count : null);
  }
  return out;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export function windowLabel(sampling: QCResults["report"]["sampling"]): string {
  const start = formatTimecode(sampling.start_s);
  return sampling.max_seconds ? `${start} – ${formatTimecode(sampling.start_s + sampling.max_seconds)}` : `${start} – end`;
}

export function overviewTiles(r: QCResults): Tile[] {
  const v = r.video;
  const tech = r.report.technical;
  const s = r.report.sampling;
  return [
    { label: "Duration", value: formatDuration(v.duration_s), detail: `${formatNumber(v.frame_count)} frames` },
    {
      label: "Resolution",
      value: `${v.display_width} × ${v.display_height}`,
      detail: `${formatNumber(v.fps, 2)} fps · ${tech.orientation.display}`,
    },
    { label: "Codec", value: v.codec.toUpperCase(), detail: [v.profile, v.pix_fmt].filter(Boolean).join(" · ") || undefined },
    { label: "Bitrate", value: formatBitrate(tech.bitrate.video_kbps), detail: `File ${formatBytes(v.size_bytes)}` },
    {
      label: "Analysed",
      value: `${formatNumber(s.frames_analyzed)} frames`,
      detail: `Every ${ordinal(s.frame_stride)} frame · ${windowLabel(s)}`,
    },
  ];
}

/** Objective integrity checks (no uncalibrated thresholds involved). */
export function integrityFlags(r: QCResults): Flag[] {
  const dec = r.report.technical.decode_errors;
  const flags: Flag[] = [];
  flags.push(
    dec.count === 0 && (dec.ffmpeg_exit_code ?? 0) === 0
      ? { status: "good", label: "No decode errors" }
      : {
        status: "critical",
        label: `${formatNumber(dec.count)} decode error${dec.count === 1 ? "" : "s"}`,
        detail: dec.ffmpeg_exit_code ? `FFmpeg exited with code ${dec.ffmpeg_exit_code}` : dec.messages[0],
      },
  );
  const gap = Math.abs(dec.frames_expected - dec.frames_decoded);
  flags.push(
    gap <= 1
      ? { status: "good", label: "All frames decoded", detail: `${formatNumber(dec.frames_decoded)} of ${formatNumber(dec.frames_expected)}` }
      : { status: "warning", label: "Missing frames", detail: `${formatNumber(dec.frames_decoded)} of ${formatNumber(dec.frames_expected)} decoded` },
  );
  flags.push(r.video.has_gpmf
    ? { status: "good", label: "GPMF telemetry present" }
    : { status: "neutral", label: "No GPMF telemetry", detail: "IMU metrics unavailable" });
  if (r.imu) {
    const failed = r.imu.checks.filter((c) => !c.passed);
    flags.push(failed.length === 0
      ? { status: "good", label: `All ${r.imu.checks.length} IMU checks passed` }
      : { status: "warning", label: `${failed.length} IMU check${failed.length === 1 ? "" : "s"} failed`, detail: failed.map((c) => c.name).join(", ") });
  }
  return flags;
}

export function distributionDetail(d: Distribution, decimals = 1): string {
  return `p5 ${formatNumber(d.p5, decimals)} · median ${formatNumber(d.p50, decimals)} · p95 ${formatNumber(d.p95, decimals)}`;
}

export function imageTiles(t: TechnicalReport): Tile[] {
  return [
    { label: "Mean luminance", value: formatNumber(t.luminance.mean, 1), detail: `0–255 · ${distributionDetail(t.luminance)}` },
    { label: "Mean sharpness", value: formatNumber(t.sharpness.mean, 0), detail: distributionDetail(t.sharpness, 0) },
    { label: "Mean blockiness", value: formatNumber(t.blockiness.mean, 3), detail: "≈1.0 means no visible block grid" },
    {
      label: "Colour cast",
      value: t.colour_cast.cast_hue_deg === null ? "None" : `${formatNumber(t.colour_cast.cast_hue_deg, 0)}°`,
      detail: `Mean factor ${formatNumber(t.colour_cast.factor.mean, 2)}`,
    },
  ];
}

export function imageMeters(t: TechnicalReport): MeterView[] {
  return [
    { label: "Dark frames", value: t.luminance.dark_frames_pct, note: "Mean luma below the dark threshold" },
    { label: "Bright frames", value: t.luminance.bright_frames_pct, note: "Mean luma above the bright threshold" },
    { label: "Blurry frames", value: t.sharpness.blurry_frames_pct, note: "Threshold not yet calibrated" },
    { label: "Colour-cast frames", value: t.colour_cast.cast_frames_pct, note: "Cast factor above the limit" },
  ];
}

/** True when `version` ("major.minor") is at least `min`. Unparseable versions count as old. */
export function schemaAtLeast(version: string, min: string): boolean {
  const parse = (v: string) => v.split(".").map((part) => Number.parseInt(part, 10));
  const [major = Number.NaN, minor = 0] = parse(version);
  const [minMajor = 0, minMinor = 0] = parse(min);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major !== minMajor ? major > minMajor : minor >= minMinor;
}

/**
 * Report schema that fixed handedness. Older reports ran MediaPipe Tasks on a mirrored
 * copy of every frame, so each hand was named after the other one.
 */
export const HANDEDNESS_FIXED_IN = "1.2";

export function handsSwapped(report: QCReport): boolean {
  return Boolean(report.hands) && !schemaAtLeast(report.schema_version, HANDEDNESS_FIXED_IN);
}

export function trackingMeters(h: HandMetrics): MeterView[] {
  return [
    { label: "Either hand visible", value: h.either_hand_pct },
    { label: "Both hands visible", value: h.both_hands_pct },
    { label: "Left hand visible", value: h.left_hand_pct },
    { label: "Right hand visible", value: h.right_hand_pct },
  ];
}

export function trackingTiles(h: HandMetrics): Tile[] {
  return [
    {
      label: "Tracking losses", value: formatNumber(h.tracking_losses),
      detail: `Left ${formatNumber(h.per_hand.left.tracking_losses)} · right ${formatNumber(h.per_hand.right.tracking_losses)}`,
    },
    { label: "Untracked", value: formatPercent(h.untracked_pct), detail: "No hand detected" },
    { label: "Longest gap", value: formatDuration(h.longest_hand_gap), detail: "Longest stretch with no hand" },
  ];
}

/** Below this |laterality index| (45–55% of contact time per hand) neither hand dominates. */
export const BALANCED_LATERALITY = 0.1;

/** Laterality index (−1 left only … +1 right only) as words plus each hand's share. */
export function dominantHand(index: number | null): { value: string; detail: string } {
  if (index === null) return { value: "—", detail: "No contact" };
  const right = Math.round(((1 + index) / 2) * 100);
  const value = Math.abs(index) < BALANCED_LATERALITY ? "Balanced" : index > 0 ? "Right" : "Left";
  return { value, detail: `Contact time: left ${100 - right}% · right ${right}%` };
}

const pctOrDash = (v: number | null) => (v === null ? "—" : formatPercent(v));

export function hoiMeters(h: HandMetrics): MeterView[] {
  const meters: MeterView[] = [{ label: "Hand-object interaction", value: h.HOI_pct, note: "Share of time with a hand in contact" }];
  if (h.hoi) {
    meters.push(
      { label: "Contact while visible", value: h.hoi.contact_while_visible_pct, note: "Of the time a hand is visible" },
      { label: "Two-handed contact", value: h.hoi.bimanual_pct, note: "Both hands in contact at once" },
      { label: "Idle hands", value: h.hoi.idle_hands_pct, note: "A hand is visible, neither is in contact" },
    );
  }
  return meters;
}

/** Six tiles with the HOI block (one row wide, 3 × 2 or 2 × 3 narrower); two without it. */
export function hoiTiles(h: HandMetrics): Tile[] {
  const counts = `${formatNumber(h.per_hand.left.grasp_count)} · right ${formatNumber(h.per_hand.right.grasp_count)}`;
  const meanGrasp: Tile = {
    label: "Mean grasp",
    value: h.grasp_duration.mean_s === null ? "—" : formatDuration(h.grasp_duration.mean_s),
    detail: `Longest ${formatDuration(h.grasp_duration.max_s)}`,
  };
  const hoi = h.hoi;
  if (!hoi) return [{ label: "Grasps", value: formatNumber(h.grasp_count), detail: `Left ${counts}` }, meanGrasp];
  const side = (key: "left" | "right", label: string): Tile => ({
    label: `${label} hand in contact`,
    value: formatPercent(hoi.per_hand[key].contact_pct),
    detail: `${pctOrDash(hoi.per_hand[key].contact_while_visible_pct)} of its visible time`,
  });
  return [
    {
      label: "Grasp rate",
      value: hoi.grasps_per_min === null ? "—" : `${formatNumber(hoi.grasps_per_min, 1)} / min`,
      detail: `${formatNumber(h.grasp_count)} grasps: left ${counts}`,
    },
    meanGrasp,
    { label: "Dominant hand", ...dominantHand(hoi.laterality_index) },
    side("left", "Left"),
    side("right", "Right"),
    { label: "Longest without contact", value: formatDuration(hoi.longest_no_contact_s), detail: "Longest stretch with no grasp" },
  ];
}
