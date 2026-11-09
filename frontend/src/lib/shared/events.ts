/**
 * Parsing and classification of pipeline events (the JSON Lines contract with Python).
 * See src/probing_qc/events.py for the producer.
 */

import { PIPELINE_STAGES, SUPPORTED_EVENT_VERSIONS, TERMINAL_JOB_STATUSES } from "./constants";
import type { JobStatus, PipelineEvent, PipelineStage, PythonEvent } from "./types";

const LOG_LEVELS = new Set(["debug", "info", "warning", "error", "native"]);
const STAGE_STATUSES = new Set(["start", "done", "skip"]);
const JOB_STATUSES = new Set<JobStatus>(["queued", "running", "succeeded", "failed", "cancelled"]);

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function isPipelineStage(x: unknown): x is PipelineStage {
  return isStr(x) && (PIPELINE_STAGES as readonly string[]).includes(x);
}

/**
 * Validate an already-decoded object as a pipeline event.
 * Returns `null` for anything malformed or from an unsupported format version, so a
 * bad line can never crash the stream consumer.
 */
export function toPipelineEvent(raw: unknown): PipelineEvent | null {
  if (!isRecord(raw) || !isNum(raw.v) || !isNum(raw.t) || !isStr(raw.type)) return null;
  if (!SUPPORTED_EVENT_VERSIONS.includes(raw.v)) return null;
  const base = { v: raw.v, t: raw.t, ...(isNum(raw.seq) ? { seq: raw.seq } : {}) };

  switch (raw.type) {
    case "stage":
      if (!isPipelineStage(raw.stage) || !isStr(raw.status) || !STAGE_STATUSES.has(raw.status) || !isStr(raw.message)) return null;
      return {
        ...base, type: "stage", stage: raw.stage, status: raw.status as "start" | "done" | "skip",
        message: raw.message, ...(isRecord(raw.data) ? { data: raw.data } : {}),
      };
    case "progress":
      if (!isPipelineStage(raw.stage) || !isNum(raw.done) || !(raw.total === null || isNum(raw.total)) || !isStr(raw.message)) return null;
      return {
        ...base, type: "progress", stage: raw.stage, done: raw.done, total: raw.total,
        message: raw.message, ...(isStr(raw.unit) ? { unit: raw.unit } : {}),
      };
    case "log":
      if (!isStr(raw.level) || !LOG_LEVELS.has(raw.level) || !isStr(raw.message)) return null;
      return {
        ...base, type: "log", level: raw.level as "info", logger: isStr(raw.logger) ? raw.logger : "",
        message: raw.message,
      };
    case "result":
      if (!isStr(raw.path) || !isStr(raw.message)) return null;
      return { ...base, type: "result", path: raw.path, message: raw.message };
    case "error":
      if (!isStr(raw.message)) return null;
      return {
        ...base, type: "error", stage: isPipelineStage(raw.stage) ? raw.stage : null, message: raw.message,
        ...(isStr(raw.error_type) ? { error_type: raw.error_type } : {}),
      };
    case "job":
      if (!isStr(raw.status) || !JOB_STATUSES.has(raw.status as JobStatus) || !isStr(raw.message)) return null;
      return { ...base, type: "job", status: raw.status as JobStatus, message: raw.message };
    default:
      return null;
  }
}

/** Parse one stdout line from the Python job. Non-JSON or invalid lines give `null`. */
export function parseEventLine(line: string): PythonEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const event = toPipelineEvent(raw);
  // Python must never claim to be the server: drop "job" events from stdout.
  return event && event.type !== "job" ? event : null;
}

/** True for the server's final event of a job; consumers stop listening after it. */
export function isTerminalEvent(event: PipelineEvent): boolean {
  return event.type === "job" && TERMINAL_JOB_STATUSES.includes(event.status);
}

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/** Progress as a 0-1 fraction, or `null` when the total is unknown. */
export function progressFraction(done: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.min(1, Math.max(0, done / total));
}
