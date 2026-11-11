import styles from "./Notice.module.css";

export interface NoticeProps {
  /** "warning": something on the page is known to be wrong; "info": context worth reading. */
  tone?: "warning" | "info";
  title: string;
  children?: React.ReactNode;
}

/**
 * A callout above content it qualifies. Tone is shown by icon and text, not colour alone.
 * It is part of the page as rendered, not a live update, so it is a note, not an alert.
 */
export function Notice({ tone = "info", title, children }: NoticeProps) {
  return (
    <div className={styles.notice} data-tone={tone} role="note" aria-label={title}>
      <span className={styles.icon} aria-hidden="true">
        {tone === "warning" ? "!" : "i"}
      </span>
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        {children && <div className={styles.text}>{children}</div>}
      </div>
    </div>
  );
}
