"use client";

import { Meter } from "@/components/charts/Meter";
import { StatTile } from "@/components/charts/StatTile";
import type { HandMetrics } from "@/lib/shared/types";

import { ScopeNote } from "../probe/components/ScopeNote";
import { lineOf } from "../probe/lines";
import styles from "./results.module.css";
import { ResultsChart } from "./ResultsChart";
import { Section, type SectionDataProps, type SectionProbeProps } from "./Section";
import { handMeters, handTiles } from "./selectors";

export interface HandsSectionProps extends SectionDataProps {
  /** The report's hand metrics (whole analysed window). */
  hands: HandMetrics;
  probe: SectionProbeProps;
  /** Metrics of the kept part while lines are set. */
  metrics: HandMetrics | null;
}

export function HandsSection({ hands, probe, metrics, currentTime, onSeek }: HandsSectionProps) {
  const shown = metrics ?? hands;
  return (
    <Section
      id="hands"
      title="Hands"
      description="MediaPipe hand tracking from the wearer's point of view: how often each hand is visible and when it grasps. Each hand has its own charts and probe lines."
    >
      {metrics && probe.scope && <ScopeNote scope={probe.scope} />}
      <div className={styles.meters}>
        {handMeters(shown).map((m) => (
          <Meter key={m.label} label={m.label} value={m.value} note={m.note} />
        ))}
      </div>
      <div className={styles.tiles}>
        {handTiles(shown).map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} detail={t.detail} />
        ))}
      </div>
      <div className={styles.charts}>
        {probe.charts.map((chart) => (
          <ResultsChart
            key={chart.id}
            chart={chart}
            line={lineOf(probe.lines, chart.id)}
            probeDisabled={probe.probeDisabled}
            dispatch={probe.dispatch}
            bands={probe.bands}
            currentTime={currentTime}
            onSeek={onSeek}
          />
        ))}
      </div>
    </Section>
  );
}
