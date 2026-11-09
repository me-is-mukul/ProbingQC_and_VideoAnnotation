"use client";

import { Field } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import { OPTION_LIMITS } from "@/lib/shared/constants";

import { OPTION_PRESETS, type OptionsDraft } from "../state/options";
import styles from "./OptionsPanel.module.css";

export interface OptionsPanelProps {
  value: OptionsDraft;
  onChange: (value: OptionsDraft) => void;
  error?: string | null;
  disabled?: boolean;
}

/** Collapsible processing options. Empty fields mean "pipeline default". */
export function OptionsPanel({ value, onChange, error, disabled }: OptionsPanelProps) {
  const set = <K extends keyof OptionsDraft>(key: K, v: OptionsDraft[K]) => onChange({ ...value, [key]: v });
  const activePreset = OPTION_PRESETS.find((p) =>
    Object.entries(p.draft).every(([k, v]) => value[k as keyof OptionsDraft] === v),
  )?.id;

  return (
    <details className={styles.details}>
      <summary className={styles.summary}>
        <span>Processing options</span>
        <span className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.body}>
        <div className={styles.presets} role="group" aria-label="Presets">
          {OPTION_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.preset}
              aria-pressed={activePreset === p.id}
              disabled={disabled}
              onClick={() => onChange({ ...value, ...p.draft })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className={styles.grid}>
          <Field
            label="Start at"
            suffix="s"
            inputMode="decimal"
            placeholder="0"
            value={value.startS}
            disabled={disabled}
            onChange={(e) => set("startS", e.target.value)}
          />
          <Field
            label="Analyse for"
            suffix="s"
            inputMode="decimal"
            placeholder="Whole video"
            value={value.maxSeconds}
            disabled={disabled}
            onChange={(e) => set("maxSeconds", e.target.value)}
          />
          <Field
            label="Frame stride"
            inputMode="numeric"
            placeholder="4"
            hint={`Analyse every Nth frame (${OPTION_LIMITS.frameStride.min}–${OPTION_LIMITS.frameStride.max})`}
            value={value.frameStride}
            disabled={disabled}
            onChange={(e) => set("frameStride", e.target.value)}
          />
        </div>
        <div className={styles.switches}>
          <Switch label="Hand tracking" description="MediaPipe hands, grasps and interaction" checked={value.hands} disabled={disabled} onChange={(v) => set("hands", v)} />
          <Switch label="IMU telemetry" description="Accelerometer and gyroscope from GPMF" checked={value.imu} disabled={disabled} onChange={(v) => set("imu", v)} />
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
