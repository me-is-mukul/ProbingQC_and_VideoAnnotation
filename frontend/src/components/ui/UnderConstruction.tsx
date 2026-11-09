import styles from "./UnderConstruction.module.css";

/** Placeholder for tabs that are not built yet. */
export function UnderConstruction({ title, description }: { title: string; description?: string }) {
  return (
    <section className={`${styles.wrap} rise-in`} aria-labelledby="uc-title">
      <span className={styles.pulse} aria-hidden="true" />
      <p className={styles.eyebrow}>Under working</p>
      <h1 id="uc-title">{title}</h1>
      {description && <p className={styles.description}>{description}</p>}
      <p className={styles.note}>This section is being built. Check back soon.</p>
    </section>
  );
}
