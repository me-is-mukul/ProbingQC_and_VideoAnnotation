"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { saveText } from "@/lib/client/download";

import type { ProbeCommand } from "../ffmpeg-command";
import styles from "./ProbePanel.module.css";

export interface CommandViewProps {
  command: ProbeCommand;
}

/** The command (copyable), the files it needs, and what to know before running it. */
export function CommandView({ command }: CommandViewProps) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command.command);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className={styles.command}>
      <div className={styles.commandHead}>
        <span className={styles.commandLabel}>ffmpeg command</span>
        <Button variant="secondary" onClick={copy} aria-live="polite">
          {copied === "ok" ? "Copied" : copied === "failed" ? "Select and copy" : "Copy"}
        </Button>
      </div>
      <pre className={styles.code} tabIndex={0} aria-label="ffmpeg command">
        <code>{command.command}</code>
      </pre>
      {command.files.length > 0 && (
        <div className={styles.files}>
          <p>The command reads {command.files.length === 1 ? "this file" : "these files"}. Save next to the video:</p>
          <div className={styles.fileButtons}>
            {command.files.map((f) => (
              <Button key={f.name} variant="secondary" onClick={() => saveText(f.content, f.name, f.mime)}>
                Download {f.name}
              </Button>
            ))}
          </div>
        </div>
      )}
      <ul className={styles.notes}>
        {command.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
        <li>
          Writes <code>{command.output}</code>; the original video is never changed.
        </li>
      </ul>
    </div>
  );
}
