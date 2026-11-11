/**
 * Types shared by the browser and the API routes. Pure declarations, no runtime code.
 *
 * Pipeline event and results shapes mirror the Python side:
 *   - events:  src/probing_qc/events.py   (EVENT_VERSION 1)
 *   - results: src/probing_qc/job.py      (RESULTS_SCHEMA_VERSION "1.1")
 *   - report:  src/probing_qc/qc/report.py (SCHEMA_VERSION "1.2"; older reports are still read)
 */

// ---------------------------------------------------------------- pipeline stages

/** Stages emitted by `python -m probing_qc.cli.job`, in execution order. */
export type PipelineStage = "download" | "probe" | "imu" | "qc" | "results";

export type StageStatus = "start" | "done" | "skip";
export type LogLevel = "debug" | "info" | "warning" | "error";

// ---------------------------------------------------------------- events

interface EventBase {
  /** Event format version (Python `EVENT_VERSION`). */
  v: number;
  /** Unix time in seconds. */
  t: number;
  /** Monotonic per-job sequence number, assigned by the server when the event is stored. */
  seq?: number;
}

export interface StageEvent extends EventBase {
  type: "stage";
  stage: PipelineStage;
  status: StageStatus;
  message: string;
  data?: Record<string, unknown>;
}

export interface ProgressEvent extends EventBase {
  type: "progress";
  stage: PipelineStage;
  done: number;
  total: number | null;
  message: string;
  unit?: string;
}

export interface LogEvent extends EventBase {
  type: "log";
  /** "native" marks raw stderr lines from native libraries (FFmpeg, MediaPipe). */
  level: LogLevel | "native";
  logger: string;
  message: string;
}

export interface ResultEvent extends EventBase {
  type: "result";
  path: string;
  message: string;
}

export interface ErrorEvent extends EventBase {
  type: "error";
  stage: PipelineStage | null;
  message: string;
  error_type?: string;
}

/** Emitted by the Node server (not Python) whenever the job status changes. */
export interface JobStatusEvent extends EventBase {
  type: "job";
  status: JobStatus;
  message: string;
}

export type PythonEvent = StageEvent | ProgressEvent | LogEvent | ResultEvent | ErrorEvent;
export type PipelineEvent = PythonEvent | JobStatusEvent;
export type StoredEvent = PipelineEvent & { seq: number };

// ---------------------------------------------------------------- jobs

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type JobSource =
  | { kind: "upload"; uploadId: string; fileName: string; sizeBytes: number }
  | { kind: "url"; url: string; fileName: string };

/** User-tunable processing options (all optional; pipeline defaults apply). */
export interface JobOptions {
  frameStride?: number;
  startS?: number;
  maxSeconds?: number;
  hands: boolean;
  imu: boolean;
}

export interface Job {
  id: string;
  status: JobStatus;
  source: JobSource;
  options: JobOptions;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  error?: { message: string; stage: PipelineStage | null };
}

/** Body of `POST /api/jobs`. */
export interface CreateJobRequest {
  source: { kind: "upload"; uploadId: string } | { kind: "url"; url: string };
  options?: Partial<JobOptions>;
}

/** Response of `PUT /api/uploads`. */
export interface UploadInfo {
  uploadId: string;
  fileName: string;
  sizeBytes: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ---------------------------------------------------------------- results.json

export interface Distribution {
  mean: number | null;
  std: number | null;
  min: number | null;
  p5: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface GraspDuration {
  total_s: number;
  mean_s: number | null;
  median_s: number | null;
  max_s: number | null;
}

/** `hands.hoi`: hand-object interaction breakdown (report schema 1.2+). */
export interface HoiMetrics {
  /** Both hands in contact, % of analysed time. */
  bimanual_pct: number;
  /** A hand is visible but neither is in contact, % of analysed time. */
  idle_hands_pct: number;
  /** Of the time a hand is visible, % with a hand in contact (null: no hand seen). */
  contact_while_visible_pct: number | null;
  /** Contact episodes per minute of analysed time (null: no frames). */
  grasps_per_min: number | null;
  /** Longest stretch without any contact, seconds. */
  longest_no_contact_s: number;
  /** (R − L) / (R + L) over contact time: +1 right hand only, −1 left only (null: no contact). */
  laterality_index: number | null;
  per_hand: Record<"left" | "right", { contact_pct: number; contact_while_visible_pct: number | null }>;
}

export interface HandMetrics {
  either_hand_pct: number;
  both_hands_pct: number;
  left_hand_pct: number;
  right_hand_pct: number;
  HOI_pct: number;
  tracking_losses: number;
  untracked_pct: number;
  grasp_count: number;
  grasp_duration: GraspDuration;
  longest_hand_gap: number;
  per_hand: Record<"left" | "right", { tracking_losses: number; grasp_count: number; grasp_duration: GraspDuration }>;
  /** Absent in reports before schema 1.2. */
  hoi?: HoiMetrics;
}

export interface TechnicalReport {
  duration: number;
  fps: number;
  bitrate: { video_kbps: number | null; total_kbps: number | null };
  codec: { name: string; profile: string | null; pix_fmt: string | null };
  orientation: {
    rotation_deg: number;
    display: "landscape" | "portrait";
    width: number;
    height: number;
    imu?: { source: string; up_unit_xyz: [number, number, number]; tilt_deg: Distribution };
  };
  decode_errors: {
    count: number;
    ffmpeg_exit_code: number | null;
    frames_expected: number;
    frames_decoded: number;
    messages: string[];
  };
  luminance: Distribution & { dark_frames_pct: number; bright_frames_pct: number };
  sharpness: Distribution & { blurry_frames_pct: number };
  blockiness: Distribution;
  colour_cast: { offset: Distribution; factor: Distribution; cast_frames_pct: number; cast_hue_deg: number | null };
}

export interface QCReport {
  schema_version: string;
  video: { file: string; size_bytes: number; frame_count: number; has_gpmf: boolean };
  sampling: { frame_stride: number; analysis_fps: number; start_s: number; max_seconds: number | null; frames_analyzed: number };
  technical: TechnicalReport;
  hands?: HandMetrics;
  config: Record<string, unknown>;
  runtime: Record<string, unknown>;
}

export interface VideoSummary {
  file: string;
  size_bytes: number;
  duration_s: number;
  fps: number;
  frame_count: number;
  width: number;
  height: number;
  display_width: number;
  display_height: number;
  codec: string;
  profile: string | null;
  pix_fmt: string | null;
  video_bitrate: number | null;
  total_bitrate: number | null;
  rotation_deg: number;
  has_gpmf: boolean;
  /** Results 1.1+; absent in 1.0. */
  has_audio?: boolean;
  /** ffprobe's B-frame reorder depth (0 = display order). Results 1.1+; absent in 1.0. */
  has_b_frames?: number;
}

/** Keyframe frame numbers, "all" for all-intra video, null when they could not be read. */
export type Keyframes = number[] | "all" | null;

/** Columnar, downsampled series: `t` plus one array per column, all the same length. */
export interface SeriesPreview {
  points: number;
  bucket_size: number;
  t: Array<number | null>;
  [column: string]: Array<number | null> | number;
}

export interface ImuCheck {
  name: string;
  passed: boolean;
  value: number | null;
  expected: string;
}

export interface ImuBlock {
  summary: { samples: number; duration_s: number; rate_hz: number | null };
  units: { acc: string | null; gyro: string | null };
  checks: ImuCheck[];
  preview: SeriesPreview;
  file: string;
}

export interface QCResults {
  schema_version: string;
  created_at: string;
  source: { kind: string; file: string; url?: string };
  options: Record<string, unknown>;
  video: VideoSummary;
  /** Results 1.1+; absent (undefined) in 1.0. */
  keyframes?: Keyframes;
  report: QCReport;
  imu: ImuBlock | null;
  frames_preview: SeriesPreview;
  files: { report: string; frames_csv: string; imu_csv: string | null };
}
