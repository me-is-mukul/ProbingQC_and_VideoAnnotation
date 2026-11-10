"use client";

import { Meter } from "@/components/charts/Meter";
import { StatTile } from "@/components/charts/StatTile";
import type { QCResults } from "@/lib/shared/types";

import { ScopeNote } from "../probe/components/ScopeNote";
import { lineOf } from "../probe/lines";
import type { ImageMetrics } from "../probe/metrics";
import styles from "./results.module.css";
import { ResultsChart } from "./ResultsChart";
import { Section, type SectionDataProps, type SectionProbeProps } from "./Section";
import { imageMeters, imageTiles } from "./selectors";

export interface ImageQualitySectionProps extends SectionDataProps {
  results: QCResults;
  probe: SectionProbeProps;
  /** Metrics of the kept part while lines are set; the report's own figures otherwise. */
  metrics: ImageMetrics | null;
}

export function ImageQualitySection({ results, probe, metrics, currentTime, onSeek }: ImageQualitySectionProps) {
  const tech = metrics ? { ...results.report.technical, ...metrics } : results.report.technical;
  return (
    <Section id="image" title="Image quality" description="Exposure, focus, compression and colour, measured on every analysed frame. Click a chart to jump the video there.">
      {metrics && probe.scope && <ScopeNote scope={probe.scope} />}
      <div className={styles.tiles}>
        {imageTiles(tech).map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} detail={t.detail} />
        ))}
      </div>
      <div className={styles.meters}>
        {imageMeters(tech).map((m) => (
          <Meter key={m.label} label={m.label} value={m.value} note={m.note} />
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
