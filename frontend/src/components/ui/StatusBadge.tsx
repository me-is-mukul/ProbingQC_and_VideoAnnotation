import styles from "./StatusBadge.module.css";

export type Status = "good" | "warning" | "critical" | "neutral";

const ICONS: Record<Status, string> = { good: "✓", warning: "!", critical: "✕", neutral: "–" };

/** Status is always icon + text, never colour alone. */
export function StatusBadge({ status, children }: { status: Status; children: React.ReactNode }) {
  return (
    <span className={styles.badge} data-status={status}>
      <span className={styles.icon} aria-hidden="true">
        {ICONS[status]}
      </span>
      {children}
    </span>
  );
}
