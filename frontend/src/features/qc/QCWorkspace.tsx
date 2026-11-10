"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useJobEvents } from "@/hooks/useJobEvents";
import {
  ApiClientError, cancelJob, createJob, endpoints, fetchHealth, fetchResults, getJob, uploadVideo, type UploadHandle,
} from "@/lib/client/api";
import { fileNameFromUrl } from "@/lib/shared/validation";
import type { JobOptions, StoredEvent } from "@/lib/shared/types";

import { PipelineTerminal } from "./components/PipelineTerminal";
import { SourceForm, type SourceChoice } from "./components/SourceForm";
import { StageTracker } from "./components/StageTracker";
import { VideoStage } from "./components/VideoStage";
import styles from "./QCWorkspace.module.css";
import { ResultsDashboard } from "./results/ResultsDashboard";
import { jobIdFromSearch, replaceJobInLocation } from "./state/job-url";
import { initialSession, isBusy, sessionReducer, type SessionState } from "./state/session";

const PHASE_TEXT: Record<SessionState["phase"], string> = {
  idle: "",
  uploading: "Uploading",
  queued: "Queued",
  processing: "Processing",
  loadingResults: "Preparing charts",
  done: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
};

const message = (error: unknown) =>
  error instanceof ApiClientError || error instanceof Error ? error.message : "Something went wrong.";
const isAbort = (error: unknown) => (error as { name?: string } | null)?.name === "AbortError";

/**
 * The QC tab. Owns side effects (upload, job creation, event stream, results fetch, video
 * seeking); every state transition is delegated to the pure `sessionReducer`.
 */
export function QCWorkspace() {
  const [state, dispatch] = useReducer(sessionReducer, initialSession);
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [healthProblems, setHealthProblems] = useState<string[]>([]);
  const upload = useRef<UploadHandle | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const objectUrl = useRef<string | null>(null);

  const onEvent = useCallback((event: StoredEvent) => dispatch({ type: "event", event }), []);
  useJobEvents(state.jobId, onEvent);

  // Configuration problems (missing Python, wrong PIPELINE_ROOT) surface before anyone waits on a job.
  useEffect(() => {
    fetchHealth()
      .then((h) => setHealthProblems(h.problems ?? []))
      .catch(() => undefined);
  }, []);

  // Reopen the job named in the address bar (reload / shared link). Its events replay from the start.
  useEffect(() => {
    const id = jobIdFromSearch(window.location.search);
    if (!id) return;
    const controller = new AbortController();
    getJob(id, controller.signal)
      .then((job) => dispatch({ type: "resume", job, now: Date.now() }))
      .catch((error) => {
        if (!isAbort(error)) replaceJobInLocation(null);
      });
    return () => controller.abort();
  }, []);

  // Fetch the compact results once the server reports success.
  useEffect(() => {
    if (state.phase !== "loadingResults" || !state.jobId) return;
    const controller = new AbortController();
    fetchResults(state.jobId, controller.signal)
      .then((results) => dispatch({ type: "resultsLoaded", results, now: Date.now() }))
      .catch((error) => {
        if (!isAbort(error)) dispatch({ type: "failed", message: `Could not load results: ${message(error)}`, now: Date.now() });
      });
    return () => controller.abort();
  }, [state.phase, state.jobId]);

  // Release the local video blob when the component goes away.
  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  const start = async (source: SourceChoice, options: JobOptions) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setCurrentTime(null);
    try {
      if (source.kind === "file") {
        // Played straight from the user's disk: no bytes are streamed back from the server.
        objectUrl.current = URL.createObjectURL(source.file);
        dispatch({
          type: "begin", now: Date.now(),
          source: { kind: "file", name: source.file.name, size: source.file.size, objectUrl: objectUrl.current },
        });
        upload.current = uploadVideo(source.file, (loaded, total) => dispatch({ type: "uploadProgress", loaded, total, now: Date.now() }));
        const info = await upload.current.promise;
        upload.current = null;
        dispatch({ type: "uploaded", upload: info, now: Date.now() });
        const job = await createJob({ source: { kind: "upload", uploadId: info.uploadId }, options });
        dispatch({ type: "jobCreated", job, now: Date.now() });
        replaceJobInLocation(job.id);
      } else {
        const name = fileNameFromUrl(new URL(source.url)) || "Linked video";
        dispatch({ type: "begin", now: Date.now(), source: { kind: "url", url: source.url, name } });
        const job = await createJob({ source: { kind: "url", url: source.url }, options });
        dispatch({ type: "jobCreated", job, now: Date.now() });
        replaceJobInLocation(job.id);
      }
    } catch (error) {
      upload.current = null;
      dispatch(isAbort(error)
        ? { type: "reset" }
        : { type: "failed", message: message(error), now: Date.now() });
    }
  };

  const cancel = async () => {
    if (upload.current) {
      upload.current.abort();
      return;
    }
    if (!state.jobId) return;
    try {
      await cancelJob(state.jobId);
    } catch (error) {
      dispatch({ type: "failed", message: `Could not cancel: ${message(error)}`, now: Date.now() });
    }
  };

  const reset = () => {
    upload.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setCurrentTime(null);
    replaceJobInLocation(null);
    dispatch({ type: "reset" });
  };

  const seek = useCallback((seconds: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = seconds;
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 80 || rect.top > window.innerHeight) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // ---------------------------------------------------------------- render

  if (state.phase === "idle") {
    return (
      <div className={styles.idle}>
        <header className={`${styles.hero} rise-in`}>
          <p className={styles.eyebrow}>Quality control</p>
          <h1>Every frame, checked.</h1>
          <p className={styles.lede}>
            Upload a GoPro recording or paste a link. Metadata, IMU telemetry, image quality and hand tracking are measured in a
            single pass.
          </p>
        </header>
        {healthProblems.length > 0 && (
          <Card className={styles.banner} role="alert">
            <strong>The processing server isn&apos;t configured.</strong>
            <ul>
              {healthProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Card>
        )}
        <SourceForm onStart={start} />
      </div>
    );
  }

  const busy = isBusy(state.phase);
  const source = state.source!;
  // Cheapest source first: the local blob (upload) or the origin (link). The server stream is
  // used only when those fail, or for a reopened upload whose blob no longer exists.
  const serverVideo = state.jobId ? endpoints.video(state.jobId) : null;
  const sources =
    source.kind === "file"
      ? [source.objectUrl ?? serverVideo].filter((s): s is string => Boolean(s))
      : [source.url, ...(serverVideo && state.stages.download.status === "done" ? [serverVideo] : [])];

  return (
    <div className={styles.workspace}>
      <div className={styles.statusBar}>
        <span className={styles.pill} data-phase={state.phase}>
          <span className={styles.pillDot} aria-hidden="true" />
          {PHASE_TEXT[state.phase]}
        </span>
        <div className={styles.statusActions}>
          {busy ? (
            <Button variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          ) : (
            state.phase !== "done" && <Button onClick={reset}>New analysis</Button>
          )}
        </div>
      </div>

      <VideoStage ref={video} sources={sources} title={source.name} meta={state.video} onTimeUpdate={setCurrentTime} />

      {state.phase !== "done" && (
        <Card className={styles.progress} aria-live="polite">
          <StageTracker stages={state.stages} sourceLabel={source.kind === "file" ? "Upload" : "Download"} />
          {state.error && (
            <p className={styles.error} role="alert">
              {state.error}
            </p>
          )}
        </Card>
      )}

      {state.phase === "done" && state.results ? (
        <>
          <ResultsDashboard results={state.results} jobId={state.jobId} currentTime={currentTime} onSeek={seek} onNewAnalysis={reset} />
          <details className={styles.log}>
            <summary>Pipeline log</summary>
            <PipelineTerminal lines={state.lines} live={false} />
          </details>
        </>
      ) : (
        <PipelineTerminal lines={state.lines} live={busy} />
      )}
    </div>
  );
}
