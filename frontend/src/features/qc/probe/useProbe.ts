"use client";

import { useCallback, useDeferredValue, useMemo, useReducer, useState } from "react";

import type { QCResults } from "@/lib/shared/types";

import { buildChartData, type ChartData } from "../results/chart-data";
import { initialLines, linesReducer, type LinesAction, type LinesState } from "./lines";
import { buildProbeContext, buildProbePlan, type CutMode, type ProbeContext, type ProbePlan } from "./plan";
import { probedMetrics, type ProbedMetrics } from "./probed-metrics";
import { useFramesTable } from "./useFramesTable";

export type ProbeStatus = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

export interface Probe {
  charts: ChartData[];
  status: ProbeStatus;
  lines: LinesState;
  dispatch: (action: LinesAction) => void;
  mode: CutMode;
  setMode: (mode: CutMode) => void;
  context: ProbeContext | null;
  /** Current plan (follows the lines immediately: timeline, red bands, command). */
  plan: ProbePlan | null;
  /** Metrics of the kept part; null while no line is active. Computed at lower priority. */
  metrics: ProbedMetrics | null;
  /** True while `metrics` still reflects an earlier plan. */
  metricsPending: boolean;
}

/**
 * All probe state for one results page. Pure modules do the work; this hook only wires
 * them: frames table -> context -> plan (urgent, so dragging stays smooth) -> metrics
 * (deferred, so a long video never makes the line lag behind the pointer).
 */
export function useProbe(results: QCResults, jobId: string | null): Probe {
  const frames = useFramesTable(jobId);
  const [lines, dispatchLines] = useReducer(linesReducer, initialLines);
  const [mode, setModeState] = useState<CutMode>("exact");
  const charts = useMemo(() => buildChartData(results), [results]);

  const contextResult = useMemo(
    () => (frames.status === "ready" ? buildProbeContext(results, frames.table) : null),
    [frames, results],
  );
  const context = contextResult?.ok ? contextResult.value : null;
  const plan = useMemo(() => (context ? buildProbePlan(context, charts, lines, mode) : null), [context, charts, lines, mode]);

  const deferredPlan = useDeferredValue(plan);
  const table = frames.status === "ready" ? frames.table : null;
  const metrics = useMemo(
    () => (deferredPlan && table && deferredPlan.lines.length > 0 ? probedMetrics(results, table, deferredPlan.kept) : null),
    [deferredPlan, table, results],
  );

  const status: ProbeStatus =
    frames.status === "loading" ? { status: "loading" }
      : frames.status === "error" ? { status: "error", message: frames.message }
        : contextResult && !contextResult.ok ? { status: "error", message: contextResult.error }
          : { status: "ready" };

  const dispatch = useCallback((action: LinesAction) => dispatchLines(action), []);
  const setMode = useCallback((next: CutMode) => setModeState(next), []);

  return { charts, status, lines, dispatch, mode, setMode, context, plan, metrics, metricsPending: deferredPlan !== plan };
}
