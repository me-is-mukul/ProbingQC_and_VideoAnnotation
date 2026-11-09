import { ProgressBar } from "@/components/ui/ProgressBar";
import { PIPELINE_STAGES, STAGE_DESCRIPTIONS, STAGE_LABELS } from "@/lib/shared/constants";
import type { PipelineStage } from "@/lib/shared/types";

import type { StageView } from "../state/session";
import styles from "./StageTracker.module.css";

const STATUS_TEXT: Record<StageView["status"], string> = {
  pending: "Waiting", active: "In progress", done: "Done", skipped: "Skipped", failed: "Failed",
};

export interface StageTrackerProps {
  stages: Record<PipelineStage, StageView>;
  /** Label for the first step: "Upload" for files, "Download" for links. */
  sourceLabel: string;
}

/** Horizontal steps with the active stage's description and progress underneath. */
export function StageTracker({ stages, sourceLabel }: StageTrackerProps) {
  const active = PIPELINE_STAGES.find((s) => stages[s].status === "active") ?? null;
  const failed = PIPELINE_STAGES.find((s) => stages[s].status === "failed") ?? null;
  const focus = active ?? failed;
  const label = (s: PipelineStage) => (s === "download" ? sourceLabel : STAGE_LABELS[s]);

  return (
    <div className={styles.tracker}>
      <ol className={styles.steps}>
        {PIPELINE_STAGES.map((stage, i) => {
          const view = stages[stage];
          return (
            <li key={stage} className={styles.step} data-status={view.status}>
              <span className={styles.dot} aria-hidden="true">
                {view.status === "done" ? "✓" : view.status === "failed" ? "✕" : view.status === "skipped" ? "–" : i + 1}
              </span>
              <span className={styles.label}>{label(stage)}</span>
              <span className="visually-hidden">: {STATUS_TEXT[view.status]}</span>
            </li>
          );
        })}
      </ol>
      {focus && (
        <div className={styles.detail} key={focus}>
          <p className={styles.description}>
            <strong>{label(focus)}.</strong> {focus === "download" && sourceLabel === "Upload" ? "Sending the video to the processing server." : STAGE_DESCRIPTIONS[focus]}
          </p>
          {stages[focus].status === "active" && <ProgressBar value={stages[focus].progress} label={`${label(focus)} progress`} size="sm" />}
          {stages[focus].message && <p className={styles.message}>{stages[focus].message}</p>}
        </div>
      )}
    </div>
  );
}
