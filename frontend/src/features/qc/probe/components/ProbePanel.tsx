"use client";

import { useMemo, useState } from "react";

import { DataTable } from "@/components/charts/DataTable";
import { StatTile } from "@/components/charts/StatTile";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { fetchProbedImu } from "@/lib/client/api";
import { saveBlob, saveText } from "@/lib/client/download";
import { formatDuration, formatTimecode } from "@/lib/shared/format";
import { imuAlignedWithVideo } from "@/lib/shared/probe/imu";
import { probeFileNames } from "@/lib/shared/probe/names";
import type { QCResults } from "@/lib/shared/types";

import { Section } from "../../results/Section";
import { exactCommand, fastCommand } from "../ffmpeg-command";
import { activeCount } from "../lines";
import type { CutMode } from "../plan";
import { planFileContent } from "../plan-file";
import type { ProbeSummary } from "../summary";
import { timelineLabel } from "../summary";
import type { Probe } from "../useProbe";
import { CommandView } from "./CommandView";
import styles from "./ProbePanel.module.css";
import { ProbeTimeline } from "./ProbeTimeline";

export interface ProbePanelProps {
  results: QCResults;
  jobId: string | null;
  probe: Probe;
  summary: ProbeSummary | null;
  commandOpen: boolean;
  onOpenCommand: () => void;
  currentTime: number | null;
  onSeek: (seconds: number) => void;
}

const MAX_LISTED_PARTS = 500;

/** The Probing section: what the lines remove, the timeline, and the probing command. */
export function ProbePanel({ results, jobId, probe, summary, commandOpen, onOpenCommand, currentTime, onSeek }: ProbePanelProps) {
  const { plan, context, status } = probe;
  const [imuState, setImuState] = useState<{ status: "idle" | "loading" } | { status: "error"; message: string }>({ status: "idle" });
  const names = probeFileNames(results.video.file);
  const imuAligned = results.imu ? imuAlignedWithVideo(results.imu.preview.t, results.video.duration_s) : false;
  const fastReason = context && !context.fast.available ? context.fast.reason : null;
  const lineCount = activeCount(probe.lines);
  const hasCut = Boolean(plan && plan.removedFrames > 0);

  const command = useMemo(() => {
    if (!plan || !commandOpen) return null;
    const video = { file: results.video.file, hasAudio: results.video.has_audio ?? null };
    return plan.mode === "fast" ? fastCommand(plan, video) : exactCommand(plan, video);
  }, [plan, commandOpen, results.video.file, results.video.has_audio]);

  const downloadImu = async () => {
    if (!jobId || !summary) return;
    setImuState({ status: "loading" });
    try {
      saveBlob(await fetchProbedImu(jobId, summary.removedSeconds), names.imu);
      setImuState({ status: "idle" });
    } catch (error) {
      setImuState({ status: "error", message: error instanceof Error ? error.message : "The download failed." });
    }
  };

  const downloadPlan = () => {
    if (!plan) return;
    saveText(planFileContent({ plan, videoFile: results.video.file, jobId, createdAt: new Date() }), names.plan, "application/json");
  };

  const parts = summary
    ? summary.removedSeconds.slice(0, MAX_LISTED_PARTS).map(([a, b], i) => ({ i, a, b }))
    : [];

  return (
    <Section
      id="probing"
      title="Probing"
      description="Drag the line on any image-quality or hand chart. Each line selects the part of its chart below it (or above it, with the switch). The command removes the time selected on every chart that has a line set; the IMU data is cut to match."
    >
      {status.status === "loading" && <p className={styles.status}>Loading the frame table…</p>}
      {status.status === "error" && (
        <p className={styles.error} role="alert">
          Probing is unavailable: {status.message}
        </p>
      )}

      {plan && summary && (
        <>
          <div className={styles.tilesRow}>
            <StatTile label="Removed" value={formatDuration(summary.removedS)} detail={`${summary.removedPct.toFixed(1)}% of the video`} />
            <StatTile label="Kept" value={formatDuration(summary.keptS)} detail={`of ${formatDuration(summary.durationS)}`} />
            <StatTile label="Parts removed" value={String(summary.parts)} detail={summary.extraS > 0 ? `${formatDuration(summary.extraS)} extra for keyframes` : "Each part is one cut"} />
            <StatTile label="Lines set" value={String(lineCount)} detail={lineCount ? "Intersection of their selections" : "Drag a line on a chart"} />
          </div>

          {plan.lines.length > 0 && (
            <ul className={styles.lines} aria-label="Lines set">
              {plan.lines.map((l) => (
                <li key={l.chartId}>
                  <span>
                    {l.title} {l.direction === "below" ? "<" : ">"} <strong>{l.label}</strong>
                  </span>
                  <button type="button" className={styles.chipReset} onClick={() => probe.dispatch({ type: "reset", id: l.chartId })} aria-label={`Reset the ${l.title} line`}>
                    ×
                  </button>
                </li>
              ))}
              <li className={styles.resetAll}>
                <button type="button" className={styles.linkButton} onClick={() => probe.dispatch({ type: "resetAll" })}>
                  Reset all lines
                </button>
              </li>
            </ul>
          )}

          <div className={styles.timelineCard}>
            <ProbeTimeline
              label={timelineLabel(summary)}
              duration={summary.durationS}
              removed={summary.removedSeconds}
              extra={summary.extraSeconds}
              analysed={context ? [context.analysed[0] / plan.fps, context.analysed[1] / plan.fps] : undefined}
              currentTime={currentTime}
              onSeek={onSeek}
            />
          </div>

          <div className={styles.modeRow}>
            <SegmentedControl<CutMode>
              label="Cut method"
              options={[
                { value: "exact", label: "Exact · re-encode" },
                { value: "fast", label: "Fast · lossless", disabled: Boolean(fastReason) },
              ]}
              value={plan.mode}
              onChange={probe.setMode}
            />
            <p className={styles.modeHint}>
              {plan.mode === "exact"
                ? "Frame-accurate: the output matches the timeline exactly. Slower, re-encodes the video."
                : "Copies the original streams: quick and lossless. Each kept part starts on the next keyframe."}
              {fastReason && <span className={styles.modeReason}> Fast is unavailable: {fastReason}</span>}
            </p>
          </div>

          {!commandOpen ? (
            <div className={styles.request}>
              <Button size="lg" onClick={onOpenCommand} disabled={!hasCut}>
                Get probing command
              </Button>
              {!hasCut && <span className={styles.muted}>Set at least one line that selects part of the video.</span>}
            </div>
          ) : command && "command" in command ? (
            <CommandView command={command} />
          ) : (
            <p className={styles.status}>{command?.unavailable ?? "Set a line to build the command."}</p>
          )}

          <div className={styles.downloads}>
            <Button variant="secondary" onClick={downloadPlan} disabled={!hasCut}>
              Download plan (JSON)
            </Button>
            {results.imu && (
              <Button variant="secondary" onClick={downloadImu} disabled={!hasCut || !imuAligned || !jobId || imuState.status === "loading"}>
                {imuState.status === "loading" ? "Preparing IMU CSV…" : "Download probed IMU CSV"}
              </Button>
            )}
          </div>
          {results.imu && (
            <p className={styles.muted}>
              {imuAligned
                ? "IMU rows whose timestamp_s falls in a red part are removed; each kept row gets probed_time_s, its time in the probed video."
                : "The IMU timestamps of this clip don't start at the video's start (trimmed clip), so the IMU data can't be cut by video time."}
            </p>
          )}
          {imuState.status === "error" && (
            <p className={styles.error} role="alert">
              IMU download failed: {imuState.message}
            </p>
          )}

          {summary.parts > 0 && (
            <details className={styles.parts}>
              <summary>Removed parts ({summary.parts})</summary>
              <div className={styles.partsTable}>
                <DataTable
                caption="Removed parts"
                rowKey={(r) => r.i}
                rows={parts}
                columns={[
                  { key: "n", header: "#", numeric: true, cell: (r) => r.i + 1 },
                  { key: "a", header: "From", numeric: true, cell: (r) => formatTimecode(r.a, 2) },
                  { key: "b", header: "To", numeric: true, cell: (r) => formatTimecode(r.b, 2) },
                  { key: "d", header: "Length", numeric: true, cell: (r) => formatDuration(r.b - r.a) },
                ]}
                />
              </div>
              {summary.parts > MAX_LISTED_PARTS && (
                <p className={styles.muted}>Showing the first {MAX_LISTED_PARTS}; the plan JSON lists all {summary.parts}.</p>
              )}
            </details>
          )}
        </>
      )}
    </Section>
  );
}
