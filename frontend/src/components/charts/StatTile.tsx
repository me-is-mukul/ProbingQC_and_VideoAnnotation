import styles from "./StatTile.module.css";

export interface StatTileProps {
  label: string;
  value: string;
  detail?: React.ReactNode;
  /** Larger value; at most one hero tile per view. */
  hero?: boolean;
}

/** label · value · optional detail line. Proportional figures for the value. */
export function StatTile({ label, value, detail, hero = false }: StatTileProps) {
  return (
    <div className={styles.tile} data-hero={hero}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {detail && <span className={styles.detail}>{detail}</span>}
    </div>
  );
}
