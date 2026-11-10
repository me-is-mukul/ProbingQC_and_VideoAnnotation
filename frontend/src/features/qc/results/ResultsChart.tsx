"use client";

import { memo } from "react";

import type { TimeBand } from "@/components/charts/TimeSeriesChart";
import { TimeSeriesCard } from "@/components/charts/TimeSeriesCard";

import { LineControls } from "../probe/components/LineControls";
import type { LineState, LinesAction } from "../probe/lines";
import type { ChartData } from "./chart-data";

export interface ResultsChartProps {
  chart: ChartData;
  /** The chart's probe line; omit (with `dispatch`) for charts without one. */
  line?: LineState;
  /** True until the frame table has loaded (the line can't select anything yet). */
  probeDisabled?: boolean;
  dispatch?: (action: LinesAction) => void;
  /** Time ranges (s) the probing command removes. */
  bands?: readonly TimeBand[];
  subtitleSuffix?: string;
  currentTime?: number | null;
  onSeek?: (seconds: number) => void;
}

/** One results chart from its definition, with its probe line and red bands when given. */
export const ResultsChart = memo(function ResultsChart({
  chart, line, probeDisabled = false, dispatch, bands, subtitleSuffix = "", currentTime, onSeek,
}: ResultsChartProps) {
  const { id, title } = chart;
  const probe = chart.probe && line && dispatch ? { line, dispatch } : null;
  return (
    <TimeSeriesCard
      title={title}
      subtitle={`${chart.subtitle}${subtitleSuffix}`}
      t={chart.t}
      series={chart.series}
      formatValue={chart.formatValue}
      formatTick={chart.formatTick}
      yDomain={chart.yDomain}
      area={chart.area}
      currentTime={currentTime}
      onSelectTime={onSeek}
      bands={bands}
      threshold={probe ? {
        value: probe.line.active ? probe.line.value : null,
        direction: probe.line.direction,
        label: `Probe line for ${title}`,
        disabled: probeDisabled,
        onChange: (value) => probe.dispatch({ type: "move", id, value }),
      } : undefined}
      actions={probe ? (
        <LineControls
          chartTitle={title}
          direction={probe.line.direction}
          active={probe.line.active}
          disabled={probeDisabled}
          onDirection={(direction) => probe.dispatch({ type: "direction", id, direction })}
          onReset={() => probe.dispatch({ type: "reset", id })}
        />
      ) : undefined}
    />
  );
});
