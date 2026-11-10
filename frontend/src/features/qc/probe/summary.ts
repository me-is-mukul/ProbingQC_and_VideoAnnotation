/** Plan -> the words and seconds the UI shows. Pure. */

import { complement, intersect, type Interval } from "@/lib/shared/probe/intervals";
import { formatDuration, formatTimecode } from "@/lib/shared/format";

import type { ProbePlan } from "./plan";
import { toSeconds } from "./plan";

export interface ProbeSummary {
  durationS: number;
  removedS: number;
  keptS: number;
  /** 0-100 */
  removedPct: number;
  /** Removed parts (each is one cut out of the video). */
  parts: number;
  /** Seconds removed only to start kept parts on keyframes (fast mode). */
  extraS: number;
  removedSeconds: Interval[];
  extraSeconds: Interval[];
}

export function summarizePlan(plan: ProbePlan): ProbeSummary {
  const durationS = plan.frameCount / plan.fps;
  const removedS = plan.removedFrames / plan.fps;
  // extra = removed − requested
  const extraFrames = intersect(plan.removed, complement(plan.requested, 0, plan.frameCount));
  return {
    durationS,
    removedS,
    keptS: plan.keptFrames / plan.fps,
    removedPct: plan.frameCount ? (100 * plan.removedFrames) / plan.frameCount : 0,
    parts: plan.removed.length,
    extraS: plan.extraFrames / plan.fps,
    removedSeconds: toSeconds(plan.removed, plan.fps),
    extraSeconds: toSeconds(extraFrames, plan.fps),
  };
}

export function timelineLabel(s: ProbeSummary): string {
  if (s.parts === 0) return `Timeline of ${formatTimecode(s.durationS)}: nothing is removed.`;
  return `Timeline of ${formatTimecode(s.durationS)}: the command removes ${formatDuration(s.removedS)} ` +
    `(${s.removedPct.toFixed(1)}%) in ${s.parts} part${s.parts === 1 ? "" : "s"}.`;
}

/** "Removing 2 min 31 s of 38 min 13 s (6.6%) · 14 parts" */
export function headline(s: ProbeSummary): string {
  if (s.parts === 0) return "Nothing selected yet";
  return `Removing ${formatDuration(s.removedS)} of ${formatDuration(s.durationS)} (${s.removedPct.toFixed(1)}%) · ` +
    `${s.parts} part${s.parts === 1 ? "" : "s"}`;
}
