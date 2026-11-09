/** Builders for pipeline events in the exact shape Python emits (EVENT_VERSION 1). */
import type { JobStatus, PipelineStage, StoredEvent } from "@/lib/shared/types";

let clock = 1_794_213_200;
export const resetClock = (t = 1_794_213_200) => {
  clock = t;
};
const tick = () => (clock += 1);

export const ev = {
  stage: (seq: number, stage: PipelineStage, status: "start" | "done" | "skip", message = `${stage} ${status}`, data?: Record<string, unknown>): StoredEvent => ({
    v: 1, t: tick(), seq, type: "stage", stage, status, message, ...(data ? { data } : {}),
  }),
  progress: (seq: number, stage: PipelineStage, done: number, total: number | null, message = `${done}/${total}`): StoredEvent => ({
    v: 1, t: tick(), seq, type: "progress", stage, done, total, message, unit: "frames",
  }),
  log: (seq: number, message: string, level: "info" | "warning" | "error" | "debug" | "native" = "info", logger = "qc"): StoredEvent => ({
    v: 1, t: tick(), seq, type: "log", level, logger, message,
  }),
  error: (seq: number, message: string, stage: PipelineStage | null = "qc"): StoredEvent => ({
    v: 1, t: tick(), seq, type: "error", stage, message, error_type: "ValueError",
  }),
  result: (seq: number): StoredEvent => ({ v: 1, t: tick(), seq, type: "result", path: "results.json", message: "Processing complete" }),
  job: (seq: number, status: JobStatus, message: string = status): StoredEvent => ({ v: 1, t: tick(), seq, type: "job", status, message }),
};
