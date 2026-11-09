"use client";

import { useState } from "react";

import styles from "./ChartCard.module.css";

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** The chart. */
  children: React.ReactNode;
  /** Table-view twin of the chart (rendered only when opened). */
  table?: () => React.ReactNode;
  className?: string;
}

/** Card frame for one chart: title, subtitle and a Chart / Table toggle. */
export function ChartCard({ title, subtitle, children, table, className }: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className={[styles.card, className].filter(Boolean).join(" ")}>
      <figcaption className={styles.header}>
        <div className={styles.titles}>
          <h3>{title}</h3>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {table && (
          <button type="button" className={styles.toggle} aria-pressed={showTable} onClick={() => setShowTable((s) => !s)}>
            {showTable ? "Chart" : "Table"}
          </button>
        )}
      </figcaption>
      {showTable && table ? <div className={styles.tableWrap}>{table()}</div> : children}
    </figure>
  );
}
