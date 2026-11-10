/**
 * Report metrics for the part of the video a plan keeps. Thresholds come from the job's
 * own `report.config` (never from defaults copied into TypeScript), and `dt` is computed
 * the way the pipeline computes it (frame_stride / fps).
 */

import type { Interval } from "@/lib/shared/probe/intervals";
import type { HandMetrics, QCResults } from "@/lib/shared/types";

import type { FramesTable } from "./frames-table";
import { handMetrics, imageMetrics, type HandThresholds, type ImageMetrics, type ImageThresholds } from "./metrics";
import { keptRows } from "./plan";

export interface ProbedMetrics {
  /** Analysed frames inside the kept part. */
  rows: number;
  image: ImageMetrics | null;
  hands: HandMetrics | null;
}

function numbers<K extends string>(source: unknown, keys: readonly K[]): Record<K, number> | null {
  const o = source as Record<string, unknown> | null | undefined;
  if (!o) return null;
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out[k] = v;
  }
  return out;
}

const IMAGE_KEYS = ["dark_luma", "bright_luma", "blur_sharpness", "cast_factor"] as const;
const HAND_KEYS = ["min_loss_s", "grasp_merge_gap_s", "grasp_min_duration_s"] as const;

export function probedMetrics(r: QCResults, table: FramesTable, kept: readonly Interval[]): ProbedMetrics {
  const rows = keptRows(table.frame, kept);
  const image: ImageThresholds | null = numbers(r.report.config.image, IMAGE_KEYS);
  const hand: HandThresholds | null = numbers(r.report.config.hands, HAND_KEYS);
  const dt = r.report.sampling.frame_stride / r.video.fps;
  return {
    rows: rows.length,
    image: image ? imageMetrics(table.image, rows, image) : null,
    hands: r.report.hands && table.hands && hand ? handMetrics(table.hands, rows, dt, hand) : null,
  };
}
