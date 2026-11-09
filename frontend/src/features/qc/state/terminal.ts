/**
 * Pipeline events -> on-screen terminal lines. Pure.
 *
 * Progress lines carry a `progressKey`; a new progress line with the same key replaces
 * the previous one when it is still the last line, so a running counter updates in
 * place instead of scrolling hundreds of lines.
 */

import { STAGE_LABELS } from "@/lib/shared/constants";
import { progressFraction } from "@/lib/shared/events";
import type { PipelineEvent, PipelineStage } from "@/lib/shared/types";

export type LineTone = "default" | "muted" | "accent" | "success" | "warning" | "error";

export interface TerminalLine {
  id: number;
  /** Unix seconds. */
  t: number;
  tone: LineTone;
  /** Short source tag shown in the gutter: stage label, logger name, "job"... */
  tag: string;
  text: string;
  stage?: PipelineStage;
  progressKey?: string;
}

export type LineDraft = Omit<TerminalLine, "id">;

const LOG_TONES: Record<string, LineTone> = {
  debug: "muted", native: "muted", info: "default", warning: "warning", error: "error",
};

function percent(done: number, total: number | null): string {
  const f = progressFraction(done, total);
  return f === null ? "" : ` · ${Math.round(f * 100)}%`;
}

function shortLogger(name: string): string {
  if (!name) return "log";
  const parts = name.split(".");
  return parts[parts.length - 1] === "checks" ? "checks" : parts[parts.length - 1]!;
}

export function eventToLine(event: PipelineEvent): LineDraft | null {
  switch (event.type) {
    case "stage": {
      const tag = STAGE_LABELS[event.stage];
      if (event.status === "start") return { t: event.t, tone: "accent", tag, text: `▸ ${event.message}`, stage: event.stage };
      if (event.status === "done") {
        const elapsed = typeof event.data?.elapsed_s === "number" ? ` (${event.data.elapsed_s.toFixed(1)} s)` : "";
        return { t: event.t, tone: "success", tag, text: `✓ ${event.message}${elapsed}`, stage: event.stage };
      }
      return { t: event.t, tone: "muted", tag, text: `– ${event.message}`, stage: event.stage };
    }
    case "progress":
      return {
        t: event.t, tone: "default", tag: STAGE_LABELS[event.stage], stage: event.stage,
        text: `${event.message}${percent(event.done, event.total)}`, progressKey: event.stage,
      };
    case "log":
      return { t: event.t, tone: LOG_TONES[event.level] ?? "default", tag: shortLogger(event.logger), text: event.message };
    case "result":
      return { t: event.t, tone: "success", tag: "result", text: event.message };
    case "error":
      return {
        t: event.t, tone: "error", tag: event.stage ? STAGE_LABELS[event.stage] : "error",
        text: `✕ ${event.message}${event.error_type ? ` [${event.error_type}]` : ""}`, ...(event.stage ? { stage: event.stage } : {}),
      };
    case "job": {
      const tone: LineTone = event.status === "succeeded" ? "success" : event.status === "failed" ? "error"
        : event.status === "cancelled" ? "warning" : "muted";
      return { t: event.t, tone, tag: "job", text: event.message };
    }
    default:
      return null;
  }
}

export interface LineBuffer {
  lines: TerminalLine[];
  nextId: number;
}

/** Append (or replace an in-place progress line), keeping at most `max` lines. */
export function appendLine(buffer: LineBuffer, draft: LineDraft, max: number): LineBuffer {
  const last = buffer.lines[buffer.lines.length - 1];
  if (draft.progressKey && last?.progressKey === draft.progressKey) {
    return { lines: [...buffer.lines.slice(0, -1), { ...draft, id: last.id }], nextId: buffer.nextId };
  }
  const lines = [...buffer.lines, { ...draft, id: buffer.nextId }];
  return { lines: lines.length > max ? lines.slice(lines.length - max) : lines, nextId: buffer.nextId + 1 };
}
