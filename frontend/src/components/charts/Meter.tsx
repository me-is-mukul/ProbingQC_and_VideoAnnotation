import { formatPercent } from "@/lib/shared/format";

import styles from "./Meter.module.css";

export interface MeterProps {
  label: string;
  /** Percentage, 0-100. */
  value: number | null;
  note?: string;
}

/** A single ratio against 100%: accent fill on a lighter track of the same hue. */
export function Meter({ label, value, note }: MeterProps) {
  const pct = value === null || !Number.isFinite(value) ? null : Math.min(100, Math.max(0, value));
  return (
    <div className={styles.meter}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{formatPercent(pct)}</span>
      </div>
      <div
        className={styles.track}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-valuetext={formatPercent(pct)}
      >
        <span className={styles.fill} style={{ width: `${pct ?? 0}%` }} />
      </div>
      {note && <p className={styles.note}>{note}</p>}
    </div>
  );
}
