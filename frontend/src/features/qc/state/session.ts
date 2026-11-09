/**
 * State machine for one QC session, as a pure reducer:
 *
 *   idle ─begin─▶ uploading ─uploaded─▶ (jobCreated) queued ─▶ processing ─▶ loadingResults ─▶ done
 *        └─(url)──────────────────────▶ queued                     │
 *                                                                  └─▶ failed | cancelled
 *
 * All side effects (upload, fetch, EventSource) live in the QCWorkspace component; this
 * file only decides what the UI shows for each action, so it is fully unit-tested.
 */

import { PIPELINE_STAGES, TERMINAL_MAX_LINES } from "@/lib/shared/constants";
import { formatBytes } from "@/lib/shared/format";
import { progressFraction } from "@/lib/shared/events";
import type { Job, PipelineStage, QCResults, StoredEvent, UploadInfo, VideoSummary } from "@/lib/shared/types";

import { appendLine, eventToLine, type LineDraft, type LineTone, type TerminalLine } from "./terminal";

export type Phase = "idle" | "uploading" | "queued" | "processing" | "loadingResults" | "done" | "failed" | "cancelled";
export type StageStatusView = "pending" | "active" | "done" | "skipped" | "failed";

export interface StageView {
  status: StageStatusView;
  message: string | null;
  /** 0-1 when known. */
  progress: number | null;
}

export type SessionSource =
  | { kind: "file"; name: string; size: number; objectUrl: string | null }
  | { kind: "url"; url: string; name: string };

export interface SessionState {
  phase: Phase;
  source: SessionSource | null;
  jobId: string | null;
  lastSeq: number;
  stages: Record<PipelineStage, StageView>;
  lines: TerminalLine[];
  nextLineId: number;
  /** Known as soon as the metadata stage finishes, long before the results. */
  video: Partial<VideoSummary> | null;
  results: QCResults | null;
  error: string | null;
}

export type SessionAction =
  | { type: "begin"; source: SessionSource; now: number }
  /** Reopen an existing job (page reload, shared link); its events are then replayed from seq 0. */
  | { type: "resume"; job: Job; now: number }
  | { type: "uploadProgress"; loaded: number; total: number; now: number }
  | { type: "uploaded"; upload: UploadInfo; now: number }
  | { type: "jobCreated"; job: Job; now: number }
  | { type: "event"; event: StoredEvent }
  | { type: "resultsLoaded"; results: QCResults; now: number }
  | { type: "failed"; message: string; now: number }
  | { type: "reset" };

const pendingStages = (): Record<PipelineStage, StageView> =>
  Object.fromEntries(PIPELINE_STAGES.map((s) => [s, { status: "pending", message: null, progress: null }])) as Record<
    PipelineStage, StageView
  >;

export const initialSession: SessionState = {
  phase: "idle",
  source: null,
  jobId: null,
  lastSeq: 0,
  stages: pendingStages(),
  lines: [],
  nextLineId: 1,
  video: null,
  results: null,
  error: null,
};

function log(state: SessionState, draft: LineDraft): SessionState {
  const buffer = appendLine({ lines: state.lines, nextId: state.nextLineId }, draft, TERMINAL_MAX_LINES);
  return { ...state, lines: buffer.lines, nextLineId: buffer.nextId };
}

const local = (now: number, tone: LineTone, tag: string, text: string, progressKey?: string): LineDraft => ({
  t: now / 1000, tone, tag, text, ...(progressKey ? { progressKey } : {}),
});

function setStage(state: SessionState, stage: PipelineStage, patch: Partial<StageView>): SessionState {
  return { ...state, stages: { ...state.stages, [stage]: { ...state.stages[stage], ...patch } } };
}

function applyEvent(state: SessionState, event: StoredEvent): SessionState {
  if (event.seq <= state.lastSeq) return state; // replayed after a reconnect
  let next: SessionState = { ...state, lastSeq: event.seq };
  const line = eventToLine(event);
  if (line) next = log(next, line);

  switch (event.type) {
    case "stage": {
      if (event.status === "start") return setStage(next, event.stage, { status: "active", message: event.message, progress: null });
      if (event.status === "done") {
        next = setStage(next, event.stage, { status: "done", message: event.message, progress: 1 });
        if (event.stage === "probe" && event.data) next = { ...next, video: event.data as Partial<VideoSummary> };
        return next;
      }
      // "skip" never overrides a stage the browser already completed (the upload)
      return next.stages[event.stage].status === "done" ? next : setStage(next, event.stage, { status: "skipped", message: event.message });
    }
    case "progress":
      return setStage(next, event.stage, { status: "active", message: event.message, progress: progressFraction(event.done, event.total) });
    case "error":
      next = { ...next, error: event.message };
      return event.stage ? setStage(next, event.stage, { status: "failed", message: event.message }) : next;
    case "job":
      switch (event.status) {
        case "queued":
          return { ...next, phase: "queued" };
        case "running":
          return { ...next, phase: "processing" };
        case "succeeded":
          return { ...next, phase: "loadingResults" };
        case "failed":
          return { ...next, phase: "failed", error: next.error ?? event.message };
        case "cancelled":
          return { ...next, phase: "cancelled" };
      }
      return next;
    default:
      return next;
  }
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "begin": {
      const fresh: SessionState = { ...initialSession, stages: pendingStages(), source: action.source };
      if (action.source.kind === "file") {
        const s = setStage({ ...fresh, phase: "uploading" }, "download", { status: "active", message: "Uploading", progress: 0 });
        return log(s, local(action.now, "accent", "Source", `▸ Uploading ${action.source.name} (${formatBytes(action.source.size)})`));
      }
      return log({ ...fresh, phase: "queued" }, local(action.now, "accent", "Source", `▸ Submitting ${action.source.url}`));
    }
    case "resume": {
      const { job } = action;
      const source: SessionSource = job.source.kind === "upload"
        ? { kind: "file", name: job.source.fileName, size: job.source.sizeBytes, objectUrl: null }
        : { kind: "url", url: job.source.url, name: job.source.fileName };
      let s: SessionState = { ...initialSession, stages: pendingStages(), phase: "queued", source, jobId: job.id };
      if (job.source.kind === "upload") {
        s = setStage(s, "download", { status: "done", progress: 1, message: `Uploaded ${formatBytes(job.source.sizeBytes)}` });
      }
      return log(s, local(action.now, "muted", "job", `Reopened job ${job.id.slice(0, 8)}`));
    }
    case "uploadProgress": {
      if (state.phase !== "uploading") return state;
      const fraction = action.total > 0 ? action.loaded / action.total : null;
      const pct = fraction === null ? "" : ` · ${Math.round(fraction * 100)}%`;
      const s = setStage(state, "download", { status: "active", progress: fraction, message: "Uploading" });
      return log(s, local(action.now, "default", "Source", `Uploaded ${formatBytes(action.loaded)} of ${formatBytes(action.total)}${pct}`, "upload"));
    }
    case "uploaded": {
      const s = setStage({ ...state, phase: "queued" }, "download", {
        status: "done", progress: 1, message: `Uploaded ${formatBytes(action.upload.sizeBytes)}`,
      });
      return log(s, local(action.now, "success", "Source", `✓ Upload complete (${formatBytes(action.upload.sizeBytes)})`));
    }
    case "jobCreated":
      return log({ ...state, jobId: action.job.id }, local(action.now, "muted", "job", `Job ${action.job.id.slice(0, 8)} created`));
    case "event":
      // After a reset, late events from the previous job's stream are dropped.
      return state.phase === "idle" || !state.jobId ? state : applyEvent(state, action.event);
    case "resultsLoaded":
      return log({ ...state, phase: "done", results: action.results }, local(action.now, "success", "Charts", "✓ Results ready"));
    case "failed": {
      const active = PIPELINE_STAGES.find((s) => state.stages[s].status === "active");
      const s = active ? setStage(state, active, { status: "failed", message: action.message }) : state;
      return log({ ...s, phase: "failed", error: action.message }, local(action.now, "error", "error", `✕ ${action.message}`));
    }
    case "reset":
      return { ...initialSession, stages: pendingStages() };
  }
}

/** The stage the tracker should highlight. */
export function currentStage(state: SessionState): PipelineStage | null {
  return PIPELINE_STAGES.find((s) => state.stages[s].status === "active") ?? null;
}

export const isBusy = (phase: Phase) => phase === "uploading" || phase === "queued" || phase === "processing" || phase === "loadingResults";
