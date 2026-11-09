"use client";

import { useMemo } from "react";

import { Meter } from "@/components/charts/Meter";
import { seriesColor } from "@/components/charts/palette";
import { StatTile } from "@/components/charts/StatTile";
import { TimeSeriesCard } from "@/components/charts/TimeSeriesCard";
import { formatNumber } from "@/lib/shared/format";
import type { HandMetrics, QCResults } from "@/lib/shared/types";

import styles from "./results.module.css";
import { Section, type SectionDataProps } from "./Section";
import { column, handMeters, handTiles, rollingMean, scale, windowFor } from "./selectors";

const SMOOTHING_S = 1;

const pct = (v: number) => `${formatNumber(v, 0)}%`;

export function HandsSection({ results, hands, currentTime, onSeek }: { results: QCResults; hands: HandMetrics } & SectionDataProps) {
  const p = results.frames_preview;
  // Fractions of frames per chart point -> percentages. Left = slot 1, right = slot 2, always.
  const series = useMemo(() => {
    // Per-frame flags are 0/1; a 1 s centred rolling share makes the trend readable.
    // (Long videos are already bucketed server-side, so the window collapses to 1 there.)
    const window = windowFor(p.t, SMOOTHING_S);
    const share = (key: string) => rollingMean(scale(column(p, key), 100), window);
    const pair = (left: string, right: string) => [
      { id: left, label: "Left hand", color: seriesColor(0), values: share(left) },
      { id: right, label: "Right hand", color: seriesColor(1), values: share(right) },
    ];
    return { visible: pair("left", "right"), contact: pair("left_contact", "right_contact") };
  }, [p]);

  return (
    <Section id="hands" title="Hands" description="MediaPipe hand tracking from the wearer's point of view: how often each hand is visible and when it grasps.">
      <div className={styles.meters}>
        {handMeters(hands).map((m) => (
          <Meter key={m.label} label={m.label} value={m.value} note={m.note} />
        ))}
      </div>
      <div className={styles.tiles}>
        {handTiles(hands).map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} detail={t.detail} />
        ))}
      </div>
      <div className={styles.charts}>
        <TimeSeriesCard
          title="Hand visibility"
          subtitle="Share of frames with the hand detected · 1 s rolling window"
          t={p.t}
          series={series.visible}
          formatValue={pct}
          yDomain={[0, 100]}
          currentTime={currentTime}
          onSelectTime={onSeek}
        />
        <TimeSeriesCard
          title="Grasp contact"
          subtitle="Share of frames flagged as holding something · 1 s rolling window"
          t={p.t}
          series={series.contact}
          formatValue={pct}
          yDomain={[0, 100]}
          currentTime={currentTime}
          onSelectTime={onSeek}
        />
      </div>
    </Section>
  );
}
