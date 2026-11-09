"use client";

import { useRef, useState } from "react";

import { VIDEO_EXTENSIONS } from "@/lib/shared/constants";
import { formatBytes } from "@/lib/shared/format";
import { hasVideoExtension } from "@/lib/shared/validation";

import styles from "./UploadDropzone.module.css";

export interface UploadDropzoneProps {
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
}

/** Drop a video or click to choose one. Only .mp4/.mov are accepted. */
export function UploadDropzone({ file, onFile, disabled }: UploadDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = (candidate: File | undefined) => {
    if (!candidate) return;
    if (!hasVideoExtension(candidate.name)) {
      setError(`Choose a ${VIDEO_EXTENSIONS.join(" or ")} video.`);
      return;
    }
    setError(null);
    onFile(candidate);
  };

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.zone}
        data-dragging={dragging}
        data-has-file={Boolean(file)}
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) accept(e.dataTransfer.files[0]);
        }}
      >
        <span className={styles.icon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        </span>
        {file ? (
          <span className={styles.text}>
            <strong>{file.name}</strong>
            <span>{formatBytes(file.size)} · click to choose another</span>
          </span>
        ) : (
          <span className={styles.text}>
            <strong>Drop a video here</strong>
            <span>or click to browse · MP4 or MOV</span>
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept={VIDEO_EXTENSIONS.join(",")}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
