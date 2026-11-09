"use client";

import { formatTimecode } from "@/lib/shared/format";

import { ChartCard } from "./ChartCard";
import { DataTable } from "./DataTable";
import { TimeSeriesChart, type TimeSeriesChartProps } from "./TimeSeriesChart";

export interface TimeSeriesCardProps extends Omit<TimeSeriesChartProps, "label"> {
  title: string;
  subtitle?: string;
}

/** A time-series chart in a card, with its table view. */
export function TimeSeriesCard({ title, subtitle, ...chart }: TimeSeriesCardProps) {
  const rows = chart.t.map((t, i) => ({ i, t }));
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      table={() => (
        <DataTable
          caption={title}
          rowKey={(r) => r.i}
          rows={rows}
          columns={[
            { key: "t", header: "Time", numeric: true, cell: (r) => formatTimecode(r.t) },
            ...chart.series.map((s) => ({
              key: s.id,
              header: s.label,
              numeric: true,
              cell: (r: { i: number }) => {
                const v = s.values[r.i];
                return typeof v === "number" ? chart.formatValue(v) : "—";
              },
            })),
          ]}
        />
      )}
    >
      <TimeSeriesChart label={title} {...chart} />
    </ChartCard>
  );
}
