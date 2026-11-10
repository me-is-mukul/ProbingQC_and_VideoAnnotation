/**
 * A probe plan as a JSON document: which lines were set and exactly which frames and
 * seconds the command removes. Saved next to the cut video, it makes the cut
 * reproducible and reviewable without the web UI.
 */

import type { Interval } from "@/lib/shared/probe/intervals";

import type { ProbePlan } from "./plan";

export const PLAN_FILE_SCHEMA = "probe-plan/1";

export interface PlanFileInput {
  plan: ProbePlan;
  videoFile: string;
  jobId: string | null;
  createdAt: Date;
}

const span = (fps: number) => ([a, b]: Interval) => ({ start_frame: a, end_frame: b, start_s: a / fps, end_s: b / fps });

export function planDocument({ plan, videoFile, jobId, createdAt }: PlanFileInput) {
  return {
    schema: PLAN_FILE_SCHEMA,
    created_at: createdAt.toISOString(),
    job_id: jobId,
    video: { file: videoFile, fps: plan.fps, frame_count: plan.frameCount },
    mode: plan.mode,
    rule: "Removed = frames whose chart point is in the selected region of every listed line (end-exclusive ranges).",
    lines: plan.lines.map((l) => ({ chart: l.chartId, title: l.title, direction: l.direction, threshold: l.value })),
    removed: plan.removed.map(span(plan.fps)),
    kept: plan.kept.map(span(plan.fps)),
    totals: {
      removed_frames: plan.removedFrames,
      kept_frames: plan.keptFrames,
      extra_frames_for_keyframes: plan.extraFrames,
      removed_s: plan.removedFrames / plan.fps,
      kept_s: plan.keptFrames / plan.fps,
    },
  };
}

export function planFileContent(input: PlanFileInput): string {
  return `${JSON.stringify(planDocument(input), null, 2)}\n`;
}
