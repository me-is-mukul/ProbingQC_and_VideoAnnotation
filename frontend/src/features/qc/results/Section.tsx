import styles from "./results.module.css";

export interface SectionProps {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/** A titled block of the results page. */
export function Section({ id, title, description, children }: SectionProps) {
  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={styles.sectionHead}>
        <h2 id={`${id}-title`}>{title}</h2>
        {description && <p className={styles.sectionDescription}>{description}</p>}
      </header>
      {children}
    </section>
  );
}

/** Props every results section receives. */
export interface SectionDataProps {
  currentTime: number | null;
  onSeek: (seconds: number) => void;
}
