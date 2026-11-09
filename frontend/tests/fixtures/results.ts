/**
 * Deterministic results.json fixture (shape of src/probing_qc/job.py RESULTS_SCHEMA_VERSION 1.0).
 * Override any part per test: makeResults({ imu: null }).
 */
import type { Distribution, HandMetrics, QCResults, SeriesPreview } from "@/lib/shared/types";

const dist = (mean: number, spread = 1): Distribution => ({
  mean, std: spread, min: mean - 2 * spread, p5: mean - spread, p50: mean, p95: mean + spread, max: mean + 2 * spread,
});

export function makePreview(points: number, columns: Record<string, (i: number) => number | null>, dt = 0.5): SeriesPreview {
  const preview: SeriesPreview = { points, bucket_size: 1, t: Array.from({ length: points }, (_, i) => i * dt) };
  for (const [key, fn] of Object.entries(columns)) preview[key] = Array.from({ length: points }, (_, i) => fn(i));
  return preview;
}

export const handMetrics = (): HandMetrics => ({
  either_hand_pct: 97.3,
  both_hands_pct: 81.08,
  left_hand_pct: 89.19,
  right_hand_pct: 89.19,
  HOI_pct: 62.16,
  tracking_losses: 0,
  untracked_pct: 2.7,
  grasp_count: 5,
  grasp_duration: { total_s: 6.27, mean_s: 1.25, median_s: 1.2, max_s: 2.27 },
  longest_hand_gap: 0.13,
  per_hand: {
    left: { tracking_losses: 1, grasp_count: 4, grasp_duration: { total_s: 5.34, mean_s: 1.33, median_s: 1.2, max_s: 2.27 } },
    right: { tracking_losses: 1, grasp_count: 1, grasp_duration: { total_s: 0.93, mean_s: 0.93, median_s: 0.93, max_s: 0.93 } },
  },
});

export function makeResults(overrides: Partial<QCResults> = {}): QCResults {
  const base: QCResults = {
    schema_version: "1.0",
    created_at: "2026-11-09T08:33:32+00:00",
    source: { kind: "file", file: "GX010140.MP4" },
    options: {},
    video: {
      file: "GX010140.MP4", size_bytes: 8_669_285_837, duration_s: 4868.864, fps: 29.97002997, frame_count: 145_920,
      width: 1920, height: 1080, display_width: 1920, display_height: 1080, codec: "hevc", profile: "Main",
      pix_fmt: "yuvj420p", video_bitrate: 13_988_015, total_bitrate: 14_244_449, rotation_deg: 0, has_gpmf: true,
    },
    report: {
      schema_version: "1.1",
      video: { file: "GX010140.MP4", size_bytes: 8_669_285_837, frame_count: 145_920, has_gpmf: true },
      sampling: { frame_stride: 4, analysis_fps: 7.493, start_s: 600, max_seconds: 10, frames_analyzed: 74 },
      technical: {
        duration: 4868.864, fps: 29.97,
        bitrate: { video_kbps: 13988, total_kbps: 14244.4 },
        codec: { name: "hevc", profile: "Main", pix_fmt: "yuvj420p" },
        orientation: {
          rotation_deg: 0, display: "landscape", width: 1920, height: 1080,
          imu: { source: "GPMF ACCL", up_unit_xyz: [0.17, 0.95, 0.27], tilt_deg: dist(5.77, 5) },
        },
        decode_errors: { count: 0, ffmpeg_exit_code: 0, frames_expected: 75, frames_decoded: 74, messages: [] },
        luminance: { ...dist(98.3, 3.5), dark_frames_pct: 0, bright_frames_pct: 0 },
        sharpness: { ...dist(875.6, 146), blurry_frames_pct: 0 },
        blockiness: dist(1.05, 0.01),
        colour_cast: { offset: dist(0.91, 0.3), factor: dist(0.155, 0.05), cast_frames_pct: 0, cast_hue_deg: null },
      },
      hands: handMetrics(),
      config: { image: { analysis_width: 960 } },
      runtime: { probing_qc_version: "0.2.0" },
    },
    imu: {
      summary: { samples: 970_019, duration_s: 4868.86, rate_hz: 199.23 },
      units: { acc: "m/s²", gyro: "rad/s" },
      checks: [
        { name: "no_nans", passed: true, value: 0, expected: "0 NaN values" },
        { name: "sample_rate", passed: true, value: 199.23, expected: "150.0-250.0 Hz" },
      ],
      preview: makePreview(10, { acc_x: () => 0.1, acc_y: () => 9.7, acc_z: () => 1.2, gyro_x: () => 0, gyro_y: () => 0.01, gyro_z: () => -0.01 }, 480),
      file: "GX010140_imu.csv",
    },
    frames_preview: makePreview(8, {
      luminance: (i) => 95 + i, sharpness: (i) => 800 + 10 * i, blockiness: () => 1.05, cast_factor: () => 0.15,
      left: (i) => (i % 2 ? 1 : 0.5), right: () => 1, left_contact: () => 0.5, right_contact: () => 0, left_score: () => 0.9, right_score: () => null,
    }, 600 / 8),
    files: { report: "outputs/GX010140_qc.json", frames_csv: "outputs/GX010140_qc_frames.csv", imu_csv: "outputs/GX010140_imu.csv" },
  };
  return { ...base, ...overrides };
}
