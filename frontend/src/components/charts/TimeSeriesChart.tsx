"use client";

import { useCallback, useMemo, useState } from "react";

import { useElementWidth } from "@/hooks/useElementWidth";
import { formatTimecode } from "@/lib/shared/format";

import {
  areaPath, extent, lastFiniteIndex, linearScale, linePath, nearestIndex, niceTicks, timeTicks, type Numeric,
} from "./scales";
import { ThresholdHandle } from "./ThresholdHandle";
import styles from "./TimeSeriesChart.module.css";

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  values: ReadonlyArray<Numeric>;
}

/** A draggable horizontal line that selects the part of the chart below or above it. */
export interface ChartThreshold {
  /** null while unset: drawn dashed at the edge where it selects nothing. */
  value: number | null;
  direction: "below" | "above";
  /** Accessible name of the handle. */
  label: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export type TimeBand = readonly [start: number, end: number];

export interface TimeSeriesChartProps {
  /** Accessible name; the visible title belongs to the surrounding card. */
  label: string;
  t: ReadonlyArray<Numeric>;
  series: readonly ChartSeries[];
  formatValue: (value: number) => string;
  formatTick?: (value: number) => string;
  /** Fixed y-domain (e.g. [0, 100] for percentages); otherwise nice bounds around the data. */
  yDomain?: [number, number];
  /** Soft wash under a single series. */
  area?: boolean;
  /** Plot height in px, excluding the x-axis band (the SVG includes it). */
  height?: number;
  /** Video playhead in seconds. */
  currentTime?: number | null;
  /** Click / Enter on a point: seek the video there. */
  onSelectTime?: (seconds: number) => void;
  threshold?: ChartThreshold;
  /** Time ranges in seconds to mark in red (e.g. what a probe command removes). */
  bands?: readonly TimeBand[];
}

const MARGIN = { top: 14, bottom: 28, left: 52 };
const LABEL_GUTTER = 64;
const MIN_LABEL_GAP = 14;

/**
 * Line chart over video time. Thin 2px lines, hairline grid, one y-axis. Hover or arrow
 * keys move a crosshair that snaps to the nearest sample; the tooltip lists every series.
 * Optional: a draggable threshold line, and red bands marking time ranges.
 */
export function TimeSeriesChart({
  label, t, series, formatValue, formatTick = formatValue, yDomain, area = false, height = 180, currentTime, onSelectTime,
  threshold, bands,
}: TimeSeriesChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const xExtent = extent(t) ?? [0, 1];
    const x0 = xExtent[0];
    const x1 = xExtent[1] === xExtent[0] ? xExtent[0] + 1 : xExtent[1];
    const yExtent = extent(...series.map((s) => s.values)) ?? [0, 1];
    const y = yDomain ? { ticks: niceTicks(yDomain[0], yDomain[1], 4).ticks, domain: yDomain } : niceTicks(yExtent[0], yExtent[1], 4);
    const ticksInDomain = y.ticks.filter((v) => v >= y.domain[0] - 1e-9 && v <= y.domain[1] + 1e-9);

    // End labels name the lines directly, but only if none collide (otherwise the legend carries identity).
    const plotBottom = MARGIN.top + height;
    const provisionalY = linearScale(y.domain, [plotBottom, MARGIN.top]);
    const ends = series.map((s) => {
      const i = lastFiniteIndex(s.values);
      return i < 0 ? null : provisionalY(s.values[i] as number);
    });
    const finiteEnds = ends.filter((v): v is number => v !== null).sort((a, b) => a - b);
    const labelsFit = series.length >= 2 && series.length <= 4 && finiteEnds.length === series.length &&
      finiteEnds.every((v, i) => i === 0 || v - finiteEnds[i - 1]! >= MIN_LABEL_GAP);

    const right = labelsFit ? LABEL_GUTTER : 16;
    const sx = linearScale([x0, x1], [MARGIN.left, Math.max(MARGIN.left + 1, width - right)]);
    const sy = provisionalY;
    return {
      sx, sy, plotBottom, yDomain: y.domain, yTicks: ticksInDomain, xTicks: timeTicks(x0, x1, Math.max(2, Math.floor(width / 110))),
      labelsFit, baseline: Math.max(y.domain[0], Math.min(0, y.domain[1])),
      paths: series.map((s) => ({
        id: s.id,
        line: linePath(t, s.values, sx, sy),
        area: area && series.length === 1 ? areaPath(t, s.values, sx, sy, Math.max(y.domain[0], 0)) : "",
      })),
    };
  }, [t, series, yDomain, height, width, area]);

  const { sx, sy, plotBottom } = geometry;
  const svgHeight = plotBottom + MARGIN.bottom;

  const indexAt = useCallback(
    (clientX: number, rect: DOMRect) => nearestIndex(t, sx.invert(clientX - rect.left)),
    [t, sx],
  );

  const select = (i: number | null) => {
    const time = i === null ? undefined : t[i];
    if (onSelectTime && typeof time === "number") onSelectTime(time);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = t.length - 1;
    if (last < 0) return;
    const current = hover ?? last;
    const step = e.shiftKey ? Math.max(1, Math.round(t.length / 20)) : 1;
    const next: Record<string, number> = {
      ArrowLeft: Math.max(0, current - step), ArrowRight: Math.min(last, current + step), Home: 0, End: last,
    };
    if (e.key in next) {
      e.preventDefault();
      setHover(next[e.key]!);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(current);
    } else if (e.key === "Escape") {
      setHover(null);
    }
  };

  const hoverT = hover === null ? null : t[hover];
  const hoverX = typeof hoverT === "number" ? sx(hoverT) : null;
  const playheadX = typeof currentTime === "number" && currentTime >= sx.domain[0] && currentTime <= sx.domain[1] ? sx(currentTime) : null;
  const tooltipLeft = hoverX !== null && hoverX > width - 200;

  // Threshold: an unset line sits on the edge where it selects nothing.
  const [yMin, yMax] = geometry.yDomain;
  const thresholdValue = threshold
    ? threshold.value === null
      ? threshold.direction === "below" ? yMin : yMax
      : Math.min(yMax, Math.max(yMin, threshold.value))
    : null;
  const thresholdY = thresholdValue === null ? null : sy(thresholdValue);
  const plotRight = sx.range[1];
  const valueAt = useCallback(
    (clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      return rect ? sy.invert(clientY - rect.top) : Number.NaN;
    },
    [containerRef, sy],
  );

  const visibleBands = (bands ?? [])
    .map(([a, b]) => [Math.max(a, sx.domain[0]), Math.min(b, sx.domain[1])] as const)
    .filter(([a, b]) => b > a);

  return (
    <div className={styles.root}>
      {series.length >= 2 && (
        <ul className={styles.legend} aria-label="Legend">
          {series.map((s) => (
            <li key={s.id}>
              <span className={styles.key} style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className={styles.plotWrap}>
        <div
          ref={containerRef}
          className={styles.plot}
          tabIndex={0}
          role="group"
          aria-label={`${label}. Use the arrow keys to read values${onSelectTime ? " and Enter to jump the video there" : ""}.`}
          onKeyDown={onKeyDown}
          onFocus={() => setHover((h) => h ?? (t.length ? t.length - 1 : null))}
          onBlur={() => setHover(null)}
          data-clickable={Boolean(onSelectTime)}
        >
          <svg width={width} height={svgHeight} className={styles.svg} aria-hidden="true">
            {visibleBands.map(([a, b]) => (
              <g key={`${a}-${b}`}>
                <rect x={sx(a)} width={Math.max(1, sx(b) - sx(a))} y={MARGIN.top} height={height} className={styles.band} />
                <rect x={sx(a)} width={Math.max(1, sx(b) - sx(a))} y={MARGIN.top - 4} height={3} className={styles.bandMark} />
              </g>
            ))}

            {geometry.yTicks.map((v) => (
              <g key={v}>
                <line x1={MARGIN.left} x2={plotRight} y1={sy(v)} y2={sy(v)} className={v === geometry.baseline ? styles.baseline : styles.grid} />
                <text x={MARGIN.left - 8} y={sy(v)} className={styles.yTick}>
                  {formatTick(v)}
                </text>
              </g>
            ))}
            {geometry.xTicks.map((v) => (
              <text key={v} x={sx(v)} y={plotBottom + 18} className={styles.xTick}>
                {formatTimecode(v)}
              </text>
            ))}

            {threshold && thresholdY !== null && threshold.value !== null && (
              <rect
                x={MARGIN.left}
                width={Math.max(0, plotRight - MARGIN.left)}
                y={threshold.direction === "below" ? thresholdY : MARGIN.top}
                height={Math.max(0, threshold.direction === "below" ? plotBottom - thresholdY : thresholdY - MARGIN.top)}
                className={styles.zone}
              />
            )}

            {geometry.paths.map((p, i) => (
              <g key={p.id}>
                {p.area && <path d={p.area} className={styles.area} style={{ fill: series[i]!.color }} />}
                <path d={p.line} className={styles.line} style={{ stroke: series[i]!.color }} />
              </g>
            ))}

            {/* end markers (and direct labels when they fit) */}
            {series.map((s) => {
              const i = lastFiniteIndex(s.values);
              const x = t[i];
              if (i < 0 || typeof x !== "number") return null;
              const cy = sy(s.values[i] as number);
              return (
                <g key={s.id}>
                  <circle cx={sx(x)} cy={cy} r={4} className={styles.dot} style={{ fill: s.color }} />
                  {geometry.labelsFit && (
                    <text x={sx(x) + 10} y={cy} className={styles.endLabel}>
                      {s.label}
                    </text>
                  )}
                </g>
              );
            })}

            {threshold && thresholdY !== null && (
              <line
                x1={MARGIN.left}
                x2={plotRight}
                y1={thresholdY}
                y2={thresholdY}
                className={styles.threshold}
                data-active={threshold.value !== null}
              />
            )}

            {playheadX !== null && <line x1={playheadX} x2={playheadX} y1={MARGIN.top} y2={plotBottom} className={styles.playhead} />}

            {hoverX !== null && hover !== null && (
              <g>
                <line x1={hoverX} x2={hoverX} y1={MARGIN.top} y2={plotBottom} className={styles.crosshair} />
                {series.map((s) => {
                  const v = s.values[hover];
                  return typeof v === "number" ? (
                    <circle key={s.id} cx={hoverX} cy={sy(v)} r={4} className={styles.dot} style={{ fill: s.color }} />
                  ) : null;
                })}
              </g>
            )}

            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={Math.max(0, plotRight - MARGIN.left)}
              height={height}
              className={styles.hit}
              onPointerMove={(e) => setHover(indexAt(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()))}
              onPointerLeave={() => setHover(null)}
              onClick={(e) => select(indexAt(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()))}
            />
          </svg>

          {hoverX !== null && hover !== null && typeof hoverT === "number" && (
            <div
              className={styles.tooltip}
              style={{ left: hoverX, top: MARGIN.top, transform: tooltipLeft ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
              aria-hidden="true"
            >
              <div className={styles.tooltipTime}>{formatTimecode(hoverT)}</div>
              {series.map((s) => {
                const v = s.values[hover];
                return (
                  <div key={s.id} className={styles.tooltipRow}>
                    <span className={styles.tooltipKey} style={{ background: s.color }} aria-hidden="true" />
                    <strong>{typeof v === "number" ? formatValue(v) : "—"}</strong>
                    <span>{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="visually-hidden" aria-live="polite">
            {hover !== null && typeof hoverT === "number"
              ? `${formatTimecode(hoverT)}: ${series
                  .map((s) => `${s.label} ${typeof s.values[hover] === "number" ? formatValue(s.values[hover] as number) : "no data"}`)
                  .join(", ")}`
              : ""}
          </p>
        </div>

        {threshold && thresholdY !== null && thresholdValue !== null && (
          <ThresholdHandle
            label={threshold.label}
            y={Math.min(plotBottom - 12, Math.max(MARGIN.top + 12, thresholdY))}
            right={plotRight - 4}
            text={threshold.value === null ? "Probe" : `${threshold.direction === "below" ? "<" : ">"} ${formatValue(thresholdValue)}`}
            valueText={threshold.value === null
              ? "Not set. Use the arrow keys or drag to set it."
              : `Selects frames ${threshold.direction} ${formatValue(thresholdValue)}`}
            value={thresholdValue}
            min={yMin}
            max={yMax}
            active={threshold.value !== null}
            disabled={threshold.disabled}
            valueAt={valueAt}
            onChange={threshold.onChange}
          />
        )}
      </div>
    </div>
  );
}
