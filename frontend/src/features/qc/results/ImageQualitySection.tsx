"use client";

import { useMemo } from "react";

import { Meter } from "@/components/charts/Meter";
import { seriesColor } from "@/components/charts/palette";
import { StatTile } from "@/components/charts/StatTile";
import { TimeSeriesCard } from "@/components/charts/TimeSeriesCard";
import { formatNumber } from "@/lib/shared/format";
import type { QCResults } from "@/lib/shared/types";

import styles from "./results.module.css";
import { Section, type SectionDataProps } from "./Section";
import { column, imageMeters, imageTiles } from "./selectors";

const fixed = (d: number) => (v: number) => formatNumber(v, d);

export function ImageQualitySection({ results, currentTime, onSeek }: { results: QCResults } & SectionDataProps) {
  const tech = results.report.technical;
  const p = results.frames_preview;
  const width = (results.report.config.image as { analysis_width?: number } | undefined)?.analysis_width;
  // Memoised so the video playhead (several updates a second) never rebuilds chart paths.
  const series = useMemo(() => {
    const one = (id: string, label: string) => [{ id, label, color: seriesColor(0), values: column(p, id) }];
    return {
      luminance: one("luminance", "Luminance"),
      sharpness: one("sharpness", "Sharpness"),
      blockiness: one("blockiness", "Blockiness"),
      cast: one("cast_factor", "Cast factor"),
    };
  }, [p]);

  return (
    <Section id="image" title="Image quality" description="Exposure, focus, compression and colour, measured on every analysed frame. Click a chart to jump the video there.">
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
        <TimeSeriesCard
          title="Luminance"
          subtitle="Mean luma per frame, 0 (black) to 255 (white)"
          t={p.t}
          series={series.luminance}
          formatValue={fixed(1)}
          formatTick={fixed(0)}
          yDomain={[0, 255]}
          area
          currentTime={currentTime}
          onSelectTime={onSeek}
        />
        <TimeSeriesCard
          title="Sharpness"
          subtitle={`Variance of the Laplacian${width ? ` at ${width} px` : ""}; higher is sharper`}
          t={p.t}
          series={series.sharpness}
          formatValue={fixed(0)}
          area
          currentTime={currentTime}
          onSelectTime={onSeek}
        />
        <TimeSeriesCard
          title="Blockiness"
          subtitle="Luma step across 8×8 block edges vs inside blocks; ≈1 is clean"
          t={p.t}
          series={series.blockiness}
          formatValue={fixed(3)}
          formatTick={fixed(2)}
          currentTime={currentTime}
          onSelectTime={onSeek}
        />
        <TimeSeriesCard
          title="Colour cast factor"
          subtitle="Mean chroma offset ÷ chroma spread (CIELAB); high values mean a global tint"
          t={p.t}
          series={series.cast}
          formatValue={fixed(2)}
          currentTime={currentTime}
          onSelectTime={onSeek}
        />
      </div>
    </Section>
  );
}
