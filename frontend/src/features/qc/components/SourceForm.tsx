"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { JobOptions } from "@/lib/shared/types";
import { validateVideoUrl } from "@/lib/shared/validation";

import { DEFAULT_OPTIONS_DRAFT, draftToOptions, type OptionsDraft } from "../state/options";
import { OptionsPanel } from "./OptionsPanel";
import styles from "./SourceForm.module.css";
import { UploadDropzone } from "./UploadDropzone";

export type SourceChoice = { kind: "file"; file: File } | { kind: "url"; url: string };

export interface SourceFormProps {
  onStart: (source: SourceChoice, options: JobOptions) => void;
  disabled?: boolean;
}

type Mode = "upload" | "link";

const MODES = [
  { value: "upload", label: "Upload" },
  { value: "link", label: "Link" },
] as const;

/** Choose a video (upload or link), adjust options, start. */
export function SourceForm({ onStart, disabled }: SourceFormProps) {
  const [mode, setMode] = useState<Mode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [draft, setDraft] = useState<OptionsDraft>(DEFAULT_OPTIONS_DRAFT);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const ready = mode === "upload" ? Boolean(file) : url.trim().length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const options = draftToOptions(draft);
    setOptionsError(options.ok ? null : options.error);
    if (mode === "upload") {
      if (!file || !options.ok) return;
      onStart({ kind: "file", file }, options.value);
      return;
    }
    // Shape check only; whether private hosts are allowed is the server's decision.
    const parsed = validateVideoUrl(url, { allowPrivate: true });
    setUrlError(parsed.ok ? null : parsed.error);
    if (parsed.ok && options.ok) onStart({ kind: "url", url: parsed.value.toString() }, options.value);
  };

  return (
    <Card as="section" className={`${styles.card} rise-in`} aria-labelledby="source-title">
      <form onSubmit={submit} className={styles.form} noValidate>
        <div className={styles.head}>
          <h2 id="source-title">Add a video</h2>
          <SegmentedControl label="Video source" options={MODES} value={mode} onChange={setMode} disabled={disabled} />
        </div>

        {mode === "upload" ? (
          <UploadDropzone file={file} onFile={setFile} disabled={disabled} />
        ) : (
          <Field
            label="Video link"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://storage.example.com/GX010140.MP4"
            hint="A direct link to an MP4 or MOV file. It is downloaded on the server."
            value={url}
            error={urlError}
            disabled={disabled}
            onChange={(e) => {
              setUrl(e.target.value);
              if (urlError) setUrlError(null);
            }}
          />
        )}

        <OptionsPanel value={draft} onChange={setDraft} error={optionsError} disabled={disabled} />

        <div className={styles.actions}>
          <p className={styles.note}>Metadata, IMU telemetry and video QC run in one pass on the server.</p>
          <Button type="submit" size="lg" disabled={disabled || !ready}>
            Start analysis
          </Button>
        </div>
      </form>
    </Card>
  );
}
