import { formatDuration } from "@/lib/shared/format";

import styles from "./ScopeNote.module.css";

export interface ProbeScope {
  keptS: number;
  durationS: number;
  /** Analysed frames in the kept part. */
  rows: number;
  /** Metrics still reflect a slightly earlier line position. */
  pending: boolean;
}

/** Says that a section's figures describe the kept part, not the whole video. */
export function ScopeNote({ scope }: { scope: ProbeScope }) {
  return (
    <p className={styles.note} data-pending={scope.pending} aria-live="polite">
      <span className={styles.dot} aria-hidden="true" />
      Figures below are for the kept part: {formatDuration(scope.keptS)} of {formatDuration(scope.durationS)}
      {" "}({scope.rows.toLocaleString("en-US")} analysed frames).
      {scope.rows === 0 && " Nothing is left to measure."}
    </p>
  );
}
