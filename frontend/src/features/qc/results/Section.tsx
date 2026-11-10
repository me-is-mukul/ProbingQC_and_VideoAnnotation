import type { TimeBand } from "@/components/charts/TimeSeriesChart";

import type { ProbeScope } from "../probe/components/ScopeNote";
import type { LinesAction, LinesState } from "../probe/lines";
import type { ChartData } from "./chart-data";
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
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
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

/** What a section with charts needs to draw probe lines and the red bands. */
export interface SectionProbeProps {
  /** This section's charts (from chart-data.ts). */
  charts: readonly ChartData[];
  lines: LinesState;
  dispatch: (action: LinesAction) => void;
  probeDisabled: boolean;
  /** Seconds the probing command removes. */
  bands: readonly TimeBand[];
  /** Set while lines are active and this section's figures describe the kept part. */
  scope: ProbeScope | null;
}
