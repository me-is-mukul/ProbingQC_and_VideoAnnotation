"use client";

import { forwardRef, useId } from "react";

import styles from "./Field.module.css";

export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
  suffix?: string;
}

/** Labelled input with hint, error and an optional unit suffix. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, suffix, className, ...props },
  ref,
) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.control} data-invalid={Boolean(error)}>
        <input ref={ref} id={id} className={styles.input} aria-invalid={Boolean(error)} aria-describedby={describedBy} {...props} />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {error ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className={styles.hint}>
            {hint}
          </p>
        )
      )}
    </div>
  );
});
