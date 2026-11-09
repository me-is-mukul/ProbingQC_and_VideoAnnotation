"use client";

import { forwardRef, useState } from "react";

import { formatBytes, formatNumber } from "@/lib/shared/format";
import type { VideoSummary } from "@/lib/shared/types";

import styles from "./VideoStage.module.css";

export interface VideoStageProps {
  /**
   * Playback sources in order of preference. The first is free (a local blob for uploads,
   * the origin for links); the server stream is the paid fallback.
   */
  sources: readonly string[];
  title: string;
  meta: Partial<VideoSummary> | null;
  onTimeUpdate?: (seconds: number) => void;
}

/** The video stays on screen through processing and results; charts seek it. */
export const VideoStage = forwardRef<HTMLVideoElement, VideoStageProps>(function VideoStage(
  { sources, title, meta, onTimeUpdate },
  ref,
) {
  // Advance to the next source when one fails. Keyed on the joined list, so a new list
  // starts over from its first (cheapest) source.
  const key = sources.join("|");
  const [attempt, setAttempt] = useState<{ key: string; index: number }>({ key, index: 0 });
  const index = attempt.key === key ? attempt.index : 0;
  const src = sources[index];
  const exhausted = index >= sources.length;

  return (
    <figure className={`${styles.stage} rise-in`}>
      <div className={styles.frame}>
        {src && !exhausted ? (
          <video
            ref={ref}
            key={src}
            className={styles.video}
            src={src}
            controls
            playsInline
            preload="metadata"
            aria-label={title}
            onError={() => setAttempt({ key, index: index + 1 })}
            onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
          />
        ) : (
          <div className={styles.unavailable}>
            <p>This browser can&apos;t play the video{meta?.codec ? ` (${meta.codec.toUpperCase()})` : ""}.</p>
            <p className={styles.hint}>The analysis is unaffected. Safari and Chrome on recent hardware play HEVC.</p>
          </div>
        )}
      </div>
      <figcaption className={styles.caption}>
        <span className={styles.name}>{title}</span>
        {meta && (
          <span className={styles.meta}>
            {[
              meta.codec?.toUpperCase(),
              meta.display_width && meta.display_height ? `${meta.display_width}×${meta.display_height}` : null,
              meta.fps ? `${formatNumber(meta.fps, 2)} fps` : null,
              meta.size_bytes ? formatBytes(meta.size_bytes) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </figcaption>
    </figure>
  );
});
