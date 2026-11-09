"use client";

import { Button } from "@/components/ui/Button";
import type { QCResults } from "@/lib/shared/types";

import { HandsSection } from "./HandsSection";
import { ImageQualitySection } from "./ImageQualitySection";
import { ImuSection } from "./ImuSection";
import { OverviewSection } from "./OverviewSection";
import styles from "./results.module.css";

export interface ResultsDashboardProps {
  results: QCResults;
  currentTime: number | null;
  onSeek: (seconds: number) => void;
  onNewAnalysis: () => void;
}

/** Saves the full report from memory: no second request, no extra egress. */
function downloadReport(results: QCResults) {
  const blob = new Blob([JSON.stringify(results.report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${results.video.file.replace(/\.[^.]+$/, "")}_qc.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ResultsDashboard({ results, currentTime, onSeek, onNewAnalysis }: ResultsDashboardProps) {
  const seek = { currentTime, onSeek };
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
      <ImageQualitySection results={results} {...seek} />
      {results.report.hands && <HandsSection results={results} hands={results.report.hands} {...seek} />}
      {results.imu && <ImuSection results={results} imu={results.imu} {...seek} />}
    </div>
  );
}
