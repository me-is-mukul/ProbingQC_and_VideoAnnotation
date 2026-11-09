import Link from "next/link";

import styles from "./AppHeader.module.css";
import { TabNav } from "./TabNav";

/** Sticky translucent header: wordmark left, tabs centred (Apple-style segmented control). */
export function AppHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/qc" className={styles.brand} aria-label="Probing QC home">
          <span className={styles.mark} aria-hidden="true" />
          <span>Probing QC</span>
        </Link>
        <TabNav />
        <span className={styles.spacer} aria-hidden="true" />
      </div>
    </header>
  );
}
