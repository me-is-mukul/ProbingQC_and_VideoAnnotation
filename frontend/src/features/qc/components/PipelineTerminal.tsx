"use client";

import { useEffect, useRef, useState } from "react";

import { formatClock } from "@/lib/shared/format";

import type { TerminalLine } from "../state/terminal";
import styles from "./PipelineTerminal.module.css";

export interface PipelineTerminalProps {
  lines: readonly TerminalLine[];
  /** Shows a blinking cursor while the pipeline is still running. */
  live: boolean;
  title?: string;
}

const STICKY_THRESHOLD_PX = 24;

/**
 * Read-only terminal view of the pipeline log. Follows new output while scrolled to the
 * bottom; scrolling up pauses following until the user returns to the end.
 */
export function PipelineTerminal({ lines, live, title = "Pipeline log" }: PipelineTerminalProps) {
  const body = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  // Raw stderr from native libraries (FFmpeg, MediaPipe) is hidden unless asked for.
  const [showNative, setShowNative] = useState(false);
  const visible = showNative ? lines : lines.filter((l) => l.tone !== "muted" || l.tag !== "stderr");

  const count = visible.length;
  const lastText = visible.at(-1)?.text; // in-place progress lines change text, not length
  useEffect(() => {
    const el = body.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [count, lastText, follow]);

  const onScroll = () => {
    const el = body.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD_PX);
  };

  return (
    <section className={styles.terminal} aria-label={title}>
      <header className={styles.bar}>
        <span className={styles.lights} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className={styles.title}>{title}</span>
        <label className={styles.toggle}>
          <input type="checkbox" checked={showNative} onChange={(e) => setShowNative(e.target.checked)} />
          Native output
        </label>
      </header>
      <div ref={body} className={styles.body} onScroll={onScroll} role="log" aria-live="polite" aria-relevant="additions" tabIndex={0}>
        {visible.map((line) => (
          <div key={line.id} className={styles.line} data-tone={line.tone}>
            <span className={styles.time}>{formatClock(line.t)}</span>
            <span className={styles.tag}>{line.tag}</span>
            <span className={styles.text}>{line.text}</span>
          </div>
        ))}
        {live && <span className={styles.cursor} aria-hidden="true" />}
      </div>
      {!follow && (
        <button
          type="button"
          className={styles.jump}
          onClick={() => {
            setFollow(true);
            body.current?.scrollTo({ top: body.current.scrollHeight, behavior: "smooth" });
          }}
        >
          Jump to latest
        </button>
      )}
    </section>
  );
}
