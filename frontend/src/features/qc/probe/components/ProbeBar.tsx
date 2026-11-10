"use client";

import { Button } from "@/components/ui/Button";

import type { ProbeSummary } from "../summary";
import { headline, timelineLabel } from "../summary";
import styles from "./ProbeBar.module.css";
import { ProbeTimeline } from "./ProbeTimeline";

export interface ProbeBarProps {
  summary: ProbeSummary;
  /** Shown while lines are set and the Probing section is off screen. */
  visible: boolean;
  onOpen: () => void;
  onResetAll: () => void;
  currentTime: number | null;
  onSeek: (seconds: number) => void;
}

/** A floating summary while you drag lines further up the page: what will be removed. */
export function ProbeBar({ summary, visible, onOpen, onResetAll, currentTime, onSeek }: ProbeBarProps) {
  return (
    <aside className={styles.bar} data-visible={visible} aria-label="Probing summary" aria-hidden={!visible || undefined} inert={!visible}>
      <div className={styles.inner}>
        <div className={styles.text}>
          <strong>{headline(summary)}</strong>
        </div>
        <div className={styles.timeline}>
          <ProbeTimeline
            compact
            label={timelineLabel(summary)}
            duration={summary.durationS}
            removed={summary.removedSeconds}
            extra={summary.extraSeconds}
            currentTime={currentTime}
            onSeek={onSeek}
          />
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onResetAll}>
            Reset
          </Button>
          <Button onClick={onOpen} disabled={summary.parts === 0}>
            Probing command
          </Button>
        </div>
      </div>
    </aside>
  );
}
