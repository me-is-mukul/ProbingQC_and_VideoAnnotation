"use client";

import { useId } from "react";

import styles from "./SegmentedControl.module.css";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Disable just this option (the reason belongs in nearby text). */
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** A native radio group styled as an iOS-style segmented control (arrow keys work natively). */
export function SegmentedControl<T extends string>({ label, options, value, onChange, disabled }: SegmentedControlProps<T>) {
  const name = useId();
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={styles.group}
      style={{ "--count": options.length, "--index": index } as React.CSSProperties}
    >
      <span className={styles.thumb} aria-hidden="true" />
      {options.map((option) => (
        <label key={option.value} className={styles.option} data-checked={option.value === value}>
          <input
            type="radio"
            className="visually-hidden"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={disabled || option.disabled}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
