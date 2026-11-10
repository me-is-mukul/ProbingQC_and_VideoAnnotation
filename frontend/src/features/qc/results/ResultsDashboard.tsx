"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useInView } from "@/hooks/useInView";
import { saveText } from "@/lib/client/download";
import type { QCResults } from "@/lib/shared/types";

import { ProbeBar } from "../probe/components/ProbeBar";
import { ProbePanel } from "../probe/components/ProbePanel";
import type { ProbeScope } from "../probe/components/ScopeNote";
import { activeCount } from "../probe/lines";
import { summarizePlan } from "../probe/summary";
import { useProbe } from "../probe/useProbe";
import { chartsIn } from "./chart-data";
import { HandsSection } from "./HandsSection";
import { ImageQualitySection } from "./ImageQualitySection";
import { ImuSection } from "./ImuSection";
import { OverviewSection } from "./OverviewSection";
import styles from "./results.module.css";
import type { SectionProbeProps } from "./Section";

export interface ResultsDashboardProps {
  results: QCResults;
  /** The job the results belong to (frame table and IMU downloads); null in isolation. */
  jobId: string | null;
  currentTime: number | null;
  onSeek: (seconds: number) => void;
  onNewAnalysis: () => void;
}

/** Saves the full report from memory: no second request, no extra egress. */
function downloadReport(results: QCResults) {
  saveText(JSON.stringify(results.report, null, 2), `${results.video.file.replace(/\.[^.]+$/, "")}_qc.json`, "application/json");
}

export function ResultsDashboard({ results, jobId, currentTime, onSeek, onNewAnalysis }: ResultsDashboardProps) {
  const probe = useProbe(results, jobId);
  const [commandOpen, setCommandOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelInView = useInView(panelRef);

  const summary = useMemo(() => (probe.plan ? summarizePlan(probe.plan) : null), [probe.plan]);
  const bands = summary?.removedSeconds ?? [];
  const lineCount = activeCount(probe.lines);

  const scope: ProbeScope | null = probe.metrics && summary
    ? { keptS: summary.keptS, durationS: summary.durationS, rows: probe.metrics.rows, pending: probe.metricsPending }
    : null;

  const sectionProbe = (section: "image" | "hands"): SectionProbeProps => ({
    charts: chartsIn(probe.charts, section),
    lines: probe.lines,
    dispatch: probe.dispatch,
    probeDisabled: probe.status.status !== "ready",
    bands,
    scope,
  });

  const openCommand = useCallback(() => {
    setCommandOpen(true);
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className={styles.dashboard}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarTitle}>
          <p className={styles.eyebrow}>Results</p>
          <h2>{results.video.file}</h2>
          <p className={styles.muted}>
            Report schema {results.report.schema_version} · generated {new Date(results.created_at).toLocaleString("en-US")}
          </p>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => downloadReport(results)}>
            Download report
          </Button>
          <Button variant="ghost" onClick={onNewAnalysis}>
            New analysis
          </Button>
        </div>
      </div>
      <OverviewSection results={results} />
      <ImageQualitySection
        results={results}
        probe={sectionProbe("image")}
        metrics={probe.metrics?.image ?? null}
        currentTime={currentTime}
        onSeek={onSeek}
      />
      {results.report.hands && (
        <HandsSection
          hands={results.report.hands}
          probe={sectionProbe("hands")}
          metrics={probe.metrics?.hands ?? null}
          currentTime={currentTime}
          onSeek={onSeek}
        />
      )}
      {results.imu && (
        <ImuSection results={results} imu={results.imu} charts={chartsIn(probe.charts, "imu")} bands={bands} currentTime={currentTime} onSeek={onSeek} />
      )}
      <div ref={panelRef} className={styles.anchor}>
        <ProbePanel
          results={results}
          jobId={jobId}
          probe={probe}
          summary={summary}
          commandOpen={commandOpen}
          onOpenCommand={openCommand}
          currentTime={currentTime}
          onSeek={onSeek}
        />
      </div>
      {summary && (
        <ProbeBar
          summary={summary}
          visible={lineCount > 0 && !panelInView}
          onOpen={openCommand}
          onResetAll={() => probe.dispatch({ type: "resetAll" })}
          currentTime={currentTime}
          onSeek={onSeek}
        />
      )}
    </div>
  );
}
