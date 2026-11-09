/** Constants shared by the browser and the server. */

import type { JobStatus, PipelineStage } from "./types";

/** Event format versions this build understands (Python `EVENT_VERSION`). */
export const SUPPORTED_EVENT_VERSIONS: readonly number[] = [1];

/** results.json major versions this build can render. */
export const SUPPORTED_RESULTS_MAJOR = 1;

export const PIPELINE_STAGES: readonly PipelineStage[] = ["download", "probe", "imu", "qc", "results"];

/** Human labels for the stage tracker and terminal. */
export const STAGE_LABELS: Record<PipelineStage, string> = {
  download: "Source",
  probe: "Metadata",
  imu: "IMU",
  qc: "Video QC",
  results: "Charts",
};

/** One-line explanation of each stage, shown under the tracker while it runs. */
export const STAGE_DESCRIPTIONS: Record<PipelineStage, string> = {
  download: "Fetching the video onto the processing server.",
  probe: "Reading container metadata with ffprobe: codec, resolution, frame rate, telemetry tracks.",
  imu: "Copying the GoPro GPMF telemetry track and decoding accelerometer and gyroscope samples.",
  qc: "Decoding every frame once and measuring exposure, sharpness, compression, colour and hands.",
  results: "Downsampling the per-frame and IMU tables into chart-ready series.",
};

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

export const VIDEO_EXTENSIONS: readonly string[] = [".mp4", ".mov"];

/** Upper bounds for user options (the pipeline validates again). */
export const OPTION_LIMITS = {
  frameStride: { min: 1, max: 240 },
  startS: { min: 0, max: 24 * 3600 },
  maxSeconds: { min: 0.1, max: 24 * 3600 },
} as const;

export const DEFAULT_JOB_OPTIONS = { hands: true, imu: true } as const;

/** Lines kept in the on-screen terminal (older lines are dropped). */
export const TERMINAL_MAX_LINES = 2000;
