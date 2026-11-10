/**
 * Every results chart, defined once: what it shows, how it is formatted and whether it
 * carries a probe line. The sections render from this list and the probe selects on the
 * very same `values`, so the part of a chart that is under (or over) its line is exactly
 * the part the plan selects. Pure: no React.
 */

import { seriesColor, type SeriesSlot } from "@/components/charts/palette";
import type { ChartSeries } from "@/components/charts/TimeSeriesChart";
import { formatNumber } from "@/lib/shared/format";
import type { QCResults, SeriesPreview } from "@/lib/shared/types";

import { column, rollingMean, scale, windowFor } from "./selectors";

export type ChartSection = "image" | "hands" | "imu";

export interface ChartData {
  id: string;
  section: ChartSection;
  title: string;
  subtitle: string;
  /** True when the chart has a draggable probe line (frame-based charts only). */
  probe: boolean;
  t: ReadonlyArray<number | null>;
  series: readonly ChartSeries[];
  formatValue: (value: number) => string;
  formatTick?: (value: number) => string;
  yDomain?: [number, number];
  area?: boolean;
}

/** Window for turning per-frame 0/1 hand flags into a readable share of frames. */
export const HAND_SMOOTHING_S = 1;

const fixed = (d: number) => (v: number) => formatNumber(v, d);
const pct = (v: number) => `${formatNumber(v, 0)}%`;

function imageCharts(r: QCResults): ChartData[] {
  const p = r.frames_preview;
  const width = (r.report.config.image as { analysis_width?: number } | undefined)?.analysis_width;
  const one = (key: string, label: string) => [{ id: key, label, color: seriesColor(0), values: column(p, key) }];
  const base = { section: "image" as const, probe: true, t: p.t };
  return [
    {
      ...base, id: "luminance", title: "Luminance", subtitle: "Mean luma per frame, 0 (black) to 255 (white)",
      series: one("luminance", "Luminance"), formatValue: fixed(1), formatTick: fixed(0), yDomain: [0, 255], area: true,
    },
    {
      ...base, id: "sharpness", title: "Sharpness",
      subtitle: `Variance of the Laplacian${width ? ` at ${width} px` : ""}; higher is sharper`,
      series: one("sharpness", "Sharpness"), formatValue: fixed(0), area: true,
    },
    {
      ...base, id: "blockiness", title: "Blockiness", subtitle: "Luma step across 8×8 block edges vs inside blocks; ≈1 is clean",
      series: one("blockiness", "Blockiness"), formatValue: fixed(3), formatTick: fixed(2),
    },
    {
      ...base, id: "cast_factor", title: "Colour cast factor",
      subtitle: "Mean chroma offset ÷ chroma spread (CIELAB); high values mean a global tint",
      series: one("cast_factor", "Cast factor"), formatValue: fixed(2),
    },
  ];
}

function handCharts(p: SeriesPreview): ChartData[] {
  // Per-frame flags are 0/1; a 1 s centred rolling share makes the trend readable.
  // (Long videos are already bucketed server-side, so the window collapses to 1 there.)
  const window = windowFor(p.t, HAND_SMOOTHING_S);
  const share = (key: string) => rollingMean(scale(column(p, key), 100), window);
  // Left is always slot 1 and right slot 2, on every hand chart (colour follows the hand).
  const hands = [["left", "Left hand", 0], ["right", "Right hand", 1]] as const;
  const visibility = hands.map(([key, label, slot]): ChartData => ({
    id: `${key}_visible`, section: "hands", probe: true, t: p.t,
    title: `${label} visibility`, subtitle: `Share of frames with the ${key} hand detected · 1 s rolling window`,
    series: [{ id: key, label, color: seriesColor(slot as SeriesSlot), values: share(key) }],
    formatValue: pct, yDomain: [0, 100], area: true,
  }));
  const contact = hands.map(([key, label, slot]): ChartData => ({
    id: `${key}_contact`, section: "hands", probe: true, t: p.t,
    title: `${label} grasp contact`, subtitle: `Share of frames with the ${key} hand holding something · 1 s rolling window`,
    series: [{ id: `${key}_contact`, label, color: seriesColor(slot as SeriesSlot), values: share(`${key}_contact`) }],
    formatValue: pct, yDomain: [0, 100], area: true,
  }));
  return [...visibility, ...contact];
}

const AXES = ["x", "y", "z"] as const;

function imuCharts(r: QCResults): ChartData[] {
  if (!r.imu) return [];
  const p = r.imu.preview;
  const triple = (prefix: "acc" | "gyro") =>
    AXES.map((axis, i) => ({ id: `${prefix}_${axis}`, label: axis.toUpperCase(), color: seriesColor(i as SeriesSlot), values: column(p, `${prefix}_${axis}`) }));
  const base = { section: "imu" as const, probe: false, t: p.t };
  return [
    {
      ...base, id: "accelerometer", title: "Accelerometer", subtitle: `Includes gravity · ${r.imu.units.acc ?? "m/s²"}`,
      series: triple("acc"), formatValue: fixed(2), formatTick: fixed(0),
    },
    {
      ...base, id: "gyroscope", title: "Gyroscope", subtitle: `Angular velocity · ${r.imu.units.gyro ?? "rad/s"}`,
      series: triple("gyro"), formatValue: fixed(3), formatTick: fixed(2),
    },
  ];
}

/** All charts in page order. */
export function buildChartData(r: QCResults): ChartData[] {
  return [...imageCharts(r), ...(r.report.hands ? handCharts(r.frames_preview) : []), ...imuCharts(r)];
}

export function chartsIn(charts: readonly ChartData[], section: ChartSection): ChartData[] {
  return charts.filter((c) => c.section === section);
}
