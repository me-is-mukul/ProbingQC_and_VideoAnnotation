"use client";

import { useMemo } from "react";

import { seriesColor, type SeriesSlot } from "@/components/charts/palette";
import { StatTile } from "@/components/charts/StatTile";
import { TimeSeriesCard } from "@/components/charts/TimeSeriesCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatNumber } from "@/lib/shared/format";
import type { ImuBlock, QCResults } from "@/lib/shared/types";

import styles from "./results.module.css";
import { Section, type SectionDataProps } from "./Section";
import { column, imuAlignedWithVideo } from "./selectors";

const AXES = ["x", "y", "z"] as const;

export function ImuSection({ results, imu, currentTime, onSeek }: { results: QCResults; imu: ImuBlock } & SectionDataProps) {
  const p = imu.preview;
  const tilt = results.report.technical.orientation.imu?.tilt_deg;
  const series = useMemo(() => {
    const triple = (prefix: "acc" | "gyro") =>
      AXES.map((axis, i) => ({ id: `${prefix}_${axis}`, label: axis.toUpperCase(), color: seriesColor(i as SeriesSlot), values: column(p, `${prefix}_${axis}`) }));
    return { acc: triple("acc"), gyro: triple("gyro") };
  }, [p]);
  const fmt = (d: number) => (v: number) => formatNumber(v, d);
  const aligned = imuAlignedWithVideo(p.t, results.video.duration_s);
  const seek = aligned ? { currentTime, onSelectTime: onSeek } : {};
  const timeNote = aligned ? "" : " · original recording time (trimmed clip), not linked to the video";

  return (
    <Section id="imu" title="Motion" description="GoPro IMU telemetry for the whole recording, in the camera frame. Each point is the mean of one time bucket.">
      <div className={styles.tiles}>
        <StatTile label="Samples" value={formatNumber(imu.summary.samples)} detail={`${formatNumber(imu.summary.duration_s, 1)} s of telemetry`} />
        <StatTile label="Sample rate" value={imu.summary.rate_hz ? `${formatNumber(imu.summary.rate_hz, 1)} Hz` : "—"} detail="Accelerometer clock" />
        {tilt && <StatTile label="Camera tilt" value={`${formatNumber(tilt.p50, 1)}°`} detail={`Median · p95 ${formatNumber(tilt.p95, 1)}° in the analysed window`} />}
      </div>
      <ul className={styles.checks} aria-label="IMU sanity checks">
        {imu.checks.map((c) => (
          <li key={c.name}>
            <StatusBadge status={c.passed ? "good" : "warning"}>{c.name.replace(/_/g, " ")}</StatusBadge>
            <span className={styles.checkValue}>
              {c.value === null ? "—" : formatNumber(c.value, 2)} · expected {c.expected}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.charts}>
        <TimeSeriesCard
          title="Accelerometer"
          subtitle={`Includes gravity · ${imu.units.acc ?? "m/s²"}${timeNote}`}
          t={p.t}
          series={series.acc}
          formatValue={fmt(2)}
          formatTick={fmt(0)}
          {...seek}
        />
        <TimeSeriesCard
          title="Gyroscope"
          subtitle={`Angular velocity · ${imu.units.gyro ?? "rad/s"}${timeNote}`}
          t={p.t}
          series={series.gyro}
          formatValue={fmt(3)}
          formatTick={fmt(2)}
          {...seek}
        />
      </div>
    </Section>
  );
}
