"use client";

import { useId, useState } from "react";

import type { TimeBand } from "@/components/charts/TimeSeriesChart";
import { timeTicks } from "@/components/charts/scales";
import { useElementWidth } from "@/hooks/useElementWidth";
import { contains } from "@/lib/shared/probe/intervals";
import { formatTimecode } from "@/lib/shared/format";

import styles from "./ProbeTimeline.module.css";

export interface ProbeTimelineProps {
  /** Accessible summary, e.g. "Removes 2:31 of 38:13 in 14 parts". */
  label: string;
  duration: number;
  /** What the command removes, in seconds. */
  removed: readonly TimeBand[];
  /** The part of `removed` that is only removed to start on keyframes (fast mode). */
  extra?: readonly TimeBand[];
  /** The analysed window; time outside it has no chart data and is always kept. */
  analysed?: TimeBand;
  currentTime?: number | null;
  onSeek?: (seconds: number) => void;
  compact?: boolean;
}

/** The whole video as one bar: red is removed by the probing command, grey is kept. */
export function ProbeTimeline({ label, duration, removed, extra = [], analysed, currentTime, onSeek, compact = false }: ProbeTimelineProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hoverT, setHoverT] = useState<number | null>(null);
  const id = useId().replace(/:/g, "");
  const trackH = compact ? 10 : 28;
  const tickH = compact ? 0 : 20;
  const span = duration > 0 ? duration : 1;
  const x = (t: number) => (Math.min(Math.max(t, 0), span) / span) * width;
  const w = ([a, b]: TimeBand) => Math.max(1, x(b) - x(a));
  const notAnalysed: TimeBand[] = analysed
    ? ([[0, analysed[0]], [analysed[1], span]] as TimeBand[]).filter(([a, b]) => b - a > 1e-6)
    : [];
  const timeAt = (clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect();
    return Math.min(span, Math.max(0, ((clientX - rect.left) / Math.max(1, rect.width)) * span));
  };
  const hoverState = hoverT === null ? null
    : contains(removed, hoverT) ? (contains(extra, hoverT) ? "removed (keyframe alignment)" : "removed")
      : analysed && (hoverT < analysed[0] || hoverT >= analysed[1]) ? "kept (not analysed)" : "kept";

  return (
    <div className={styles.root} data-compact={compact}>
      <div ref={ref} className={styles.plot} data-clickable={Boolean(onSeek)} role="img" aria-label={label}>
        <svg width={width} height={trackH + tickH} className={styles.svg} aria-hidden="true">
          <defs>
            <pattern id={`na-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" className={styles.notAnalysedBg} />
              <line x1="0" y1="0" x2="0" y2="6" className={styles.notAnalysedLine} />
            </pattern>
            <pattern id={`ex-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" className={styles.extraBg} />
              <line x1="0" y1="0" x2="0" y2="6" className={styles.extraLine} />
            </pattern>
            <clipPath id={`clip-${id}`}>
              <rect width={width} height={trackH} rx={compact ? 5 : 8} />
            </clipPath>
          </defs>
          <g clipPath={`url(#clip-${id})`}>
            <rect width={width} height={trackH} className={styles.track} />
            {notAnalysed.map((b) => (
              <rect key={`na${b[0]}`} x={x(b[0])} width={w(b)} height={trackH} fill={`url(#na-${id})`} />
            ))}
            {removed.map((b) => (
              <rect key={`r${b[0]}`} x={x(b[0])} width={w(b)} height={trackH} className={styles.removed} />
            ))}
            {extra.map((b) => (
              <g key={`e${b[0]}`}>
                {/* clear the solid red first, so the hatch reads as a different kind of removal */}
                <rect x={x(b[0])} width={w(b)} height={trackH} className={styles.track} />
                <rect x={x(b[0])} width={w(b)} height={trackH} fill={`url(#ex-${id})`} />
              </g>
            ))}
          </g>
          {typeof currentTime === "number" && currentTime >= 0 && currentTime <= span && (
            <line x1={x(currentTime)} x2={x(currentTime)} y1={-3} y2={trackH + 3} className={styles.playhead} />
          )}
          {hoverT !== null && <line x1={x(hoverT)} x2={x(hoverT)} y1={0} y2={trackH} className={styles.guide} />}
          {!compact &&
            timeTicks(0, span, Math.max(2, Math.floor(width / 120))).map((t) => (
              <text key={t} x={x(t)} y={trackH + 15} className={styles.tick} data-edge={t === 0 ? "start" : x(t) > width - 20 ? "end" : undefined}>
                {formatTimecode(t)}
              </text>
            ))}
          <rect
            width={width}
            height={trackH}
            className={styles.hit}
            onPointerMove={(e) => setHoverT(timeAt(e.clientX, e.currentTarget))}
            onPointerLeave={() => setHoverT(null)}
            onClick={(e) => onSeek?.(timeAt(e.clientX, e.currentTarget))}
          />
        </svg>
        {hoverT !== null && !compact && (
          <div className={styles.readout} style={{ left: Math.min(Math.max(x(hoverT), 60), Math.max(60, width - 60)) }} aria-hidden="true">
            {formatTimecode(hoverT, 1)} · {hoverState}
          </div>
        )}
      </div>
      {!compact && (
        <ul className={styles.legend} aria-label="Timeline legend">
          <li>
            <span className={styles.swatch} data-kind="removed" aria-hidden="true" />
            Removed by the command
          </li>
          {extra.length > 0 && (
            <li>
              <span className={styles.swatch} data-kind="extra" aria-hidden="true" />
              Also removed to start on a keyframe
            </li>
          )}
          <li>
            <span className={styles.swatch} data-kind="kept" aria-hidden="true" />
            Kept
          </li>
          {notAnalysed.length > 0 && (
            <li>
              <span className={styles.swatch} data-kind="notAnalysed" aria-hidden="true" />
              Not analysed (always kept)
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
