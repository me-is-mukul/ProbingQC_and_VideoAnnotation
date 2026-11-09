import styles from "./ProgressBar.module.css";

export interface ProgressBarProps {
  /** 0-1, or null for an indeterminate (unknown total) bar. */
  value: number | null;
  label: string;
  size?: "sm" | "md";
}

export function ProgressBar({ value, label, size = "md" }: ProgressBarProps) {
  const pct = value === null ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={[styles.track, styles[size]].join(" ")}
      data-indeterminate={value === null}
    >
      <span className={styles.fill} style={pct === undefined ? undefined : { width: `${pct}%` }} />
    </div>
  );
}
