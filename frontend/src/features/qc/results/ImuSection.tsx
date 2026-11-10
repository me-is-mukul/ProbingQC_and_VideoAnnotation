"use client";

import { StatTile } from "@/components/charts/StatTile";
import type { TimeBand } from "@/components/charts/TimeSeriesChart";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatNumber } from "@/lib/shared/format";
import { imuAlignedWithVideo } from "@/lib/shared/probe/imu";
import type { ImuBlock, QCResults } from "@/lib/shared/types";

import type { ChartData } from "./chart-data";
import styles from "./results.module.css";
import { ResultsChart } from "./ResultsChart";
import { Section, type SectionDataProps } from "./Section";

export interface ImuSectionProps extends SectionDataProps {
  results: QCResults;
  imu: ImuBlock;
  charts: readonly ChartData[];
  /** Seconds the probing command removes; the probed IMU CSV drops the same time. */
  bands: readonly TimeBand[];
}

/** No probe lines here: the IMU is cut by time, following the red parts set on the other charts. */
export function ImuSection({ results, imu, charts, bands, currentTime, onSeek }: ImuSectionProps) {
  const tilt = results.report.technical.orientation.imu?.tilt_deg;
  const aligned = imuAlignedWithVideo(imu.preview.t, results.video.duration_s);
  const timeNote = aligned ? "" : " · original recording time (trimmed clip), not linked to the video";

  return (
    <Section
      id="imu"
      title="Motion"
      description="GoPro IMU telemetry for the whole recording, in the camera frame. Each point is the mean of one time bucket. Red marks the time the probing command removes; the probed IMU CSV drops the same time."
    >
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
        {charts.map((chart) => (
          <ResultsChart
            key={chart.id}
            chart={chart}
            subtitleSuffix={timeNote}
            bands={aligned ? bands : undefined}
            currentTime={aligned ? currentTime : undefined}
            onSeek={aligned ? onSeek : undefined}
          />
        ))}
      </div>
    </Section>
  );
}
