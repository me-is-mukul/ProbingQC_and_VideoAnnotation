/**
 * A small, hand-checkable probing fixture: 40 video frames at 30 fps, every 4th frame
 * analysed (10 rows: frames 0, 4, ..., 36), charts bucketed in pairs (5 points).
 *
 *   point:            0        1         2         3         4
 *   source frames:  [0,8)   [8,16)   [16,24)   [24,32)   [32,40)
 *   luminance mean:   15       35        55        75        95
 *   sharpness mean:  450      250       100       250       450
 *
 * Keyframes every 10 frames, no B-frames, with audio: fast mode is available.
 */
import type { QCResults } from "@/lib/shared/types";

import { makeResults } from "./results";

export const FPS = 30;
export const FRAME_COUNT = 40;
export const STRIDE = 4;

const frames = Array.from({ length: 10 }, (_, i) => i * STRIDE);
const luminance = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const sharpness = [500, 400, 300, 200, 100, 100, 200, 300, 400, 500];
const left = [1, 1, 0, 0, 1, 1, 1, 1, 0, 0];
const right = [0, 0, 1, 1, 1, 1, 0, 0, 1, 1];
const leftContact = [1, 0, 0, 0, 1, 1, 1, 0, 0, 0];
const rightContact = [0, 0, 1, 1, 0, 0, 0, 0, 0, 0];

const pairMean = (v: number[]) => Array.from({ length: v.length / 2 }, (_, j) => (v[2 * j]! + v[2 * j + 1]!) / 2);
const py = (b: number) => (b ? "True" : "False");

export function probeFramesCsv(withHands = true): string {
  const header = ["frame", "timestamp_s", "luminance", "sharpness", "blockiness", "cast_offset", "cast_factor", "cast_hue_deg",
    ...(withHands ? ["left", "left_score", "left_contact", "right", "right_score", "right_contact"] : [])];
  const rows = frames.map((f, i) => [
    f, (f / FPS).toFixed(4), luminance[i]!.toFixed(4), sharpness[i]!.toFixed(4), "1.0500", "2.0000", i === 3 ? "1.8000" : "0.5000", "120.0000",
    ...(withHands ? [py(left[i]!), left[i] ? "0.9000" : "", py(leftContact[i]!), py(right[i]!), right[i] ? "0.8000" : "", py(rightContact[i]!)] : []),
  ].join(","));
  return `${[header.join(","), ...rows].join("\n")}\n`;
}

export function probeResults(overrides: Partial<QCResults> = {}): QCResults {
  const base = makeResults();
  const t = pairMean(frames.map((f) => f / FPS));
  return {
    ...base,
    schema_version: "1.1",
    video: { ...base.video, file: "GX010191.MP4", fps: FPS, frame_count: FRAME_COUNT, duration_s: FRAME_COUNT / FPS, has_audio: true, has_b_frames: 0 },
    keyframes: [0, 10, 20, 30],
    report: {
      ...base.report,
      sampling: { frame_stride: STRIDE, analysis_fps: FPS / STRIDE, start_s: 0, max_seconds: null, frames_analyzed: 10 },
      config: {
        image: { analysis_width: 960, dark_luma: 40, bright_luma: 215, blur_sharpness: 150, cast_factor: 1.5 },
        hands: { min_loss_s: 0.5, grasp_merge_gap_s: 0.25, grasp_min_duration_s: 0.3 },
      },
    },
    imu: base.imu && { ...base.imu, preview: { ...base.imu.preview, t: [0.01, 0.5, 1.0] , acc_x: [0, 0, 0], acc_y: [9.8, 9.8, 9.8], acc_z: [0, 0, 0], gyro_x: [0, 0, 0], gyro_y: [0, 0, 0], gyro_z: [0, 0, 0], points: 3 } },
    frames_preview: {
      points: 5, bucket_size: 2, t,
      luminance: pairMean(luminance), sharpness: pairMean(sharpness), blockiness: [1.05, 1.05, 1.05, 1.05, 1.05],
      cast_factor: pairMean(frames.map((_, i) => (i === 3 ? 1.8 : 0.5))),
      left: pairMean(left), right: pairMean(right), left_contact: pairMean(leftContact), right_contact: pairMean(rightContact),
    },
    files: { report: "outputs/GX010191_qc.json", frames_csv: "outputs/GX010191_qc_frames.csv", imu_csv: "outputs/GX010191_imu.csv" },
    ...overrides,
  };
}
