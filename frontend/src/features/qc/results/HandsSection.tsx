"use client";

import { Meter } from "@/components/charts/Meter";
import { StatTile } from "@/components/charts/StatTile";
import { Notice } from "@/components/ui/Notice";
import type { HandMetrics } from "@/lib/shared/types";

import { ScopeNote } from "../probe/components/ScopeNote";
import { lineOf } from "../probe/lines";
import styles from "./results.module.css";
import { ResultsChart } from "./ResultsChart";
import { Section, type SectionDataProps, type SectionProbeProps } from "./Section";
import { HANDEDNESS_FIXED_IN, hoiMeters, hoiTiles, type MeterView, type Tile, trackingMeters, trackingTiles } from "./selectors";

export interface HandsSectionProps extends SectionDataProps {
  /** The report's hand metrics (whole analysed window). */
  hands: HandMetrics;
  /** Metrics of the kept part while lines are set. */
  metrics: HandMetrics | null;
  /** The report predates the handedness fix: every "left" is really the right hand. */
  swapped: boolean;
  probe: SectionProbeProps;
}

function Group({ title, note, meters, tiles }: { title: string; note?: string; meters: MeterView[]; tiles: Tile[] }) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <h3>{title}</h3>
        {note && <p className={styles.muted}>{note}</p>}
      </div>
      <div className={styles.meters}>
        {meters.map((m) => (
          <Meter key={m.label} label={m.label} value={m.value} note={m.note} />
        ))}
      </div>
      <div className={styles.tiles}>
        {tiles.map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} detail={t.detail} />
        ))}
      </div>
    </div>
  );
}

export function HandsSection({ hands, metrics, swapped, probe, currentTime, onSeek }: HandsSectionProps) {
  // The interaction breakdown is shown only for reports that carry it (schema 1.2+), so
  // figures never appear and vanish as lines are set on an older report.
  const shown = metrics ? { ...metrics, hoi: hands.hoi && metrics.hoi } : hands;
  return (
    <Section
      id="hands"
      title="Hands"
      description="MediaPipe hand tracking from the wearer's point of view: how often each hand is visible, and when it holds something. Each hand has its own charts and probe lines."
    >
      {swapped && (
        <Notice tone="warning" title="Left and right are swapped in this report">
          It was made before report schema {HANDEDNESS_FIXED_IN}, when every frame was mirrored before hand
          detection, so each figure and chart labelled “left” describes the right hand and the other way round.
          Run the video again for correctly labelled hands.
        </Notice>
      )}
      {metrics && probe.scope && <ScopeNote scope={probe.scope} />}
      <Group title="Tracking" meters={trackingMeters(shown)} tiles={trackingTiles(shown)} />
      <Group
        title="Hand-object interaction"
        note="Contact is a landmark heuristic (closed hand or thumb-index pinch); treat it as provisional."
        meters={hoiMeters(shown)}
        tiles={hoiTiles(shown)}
      />
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
