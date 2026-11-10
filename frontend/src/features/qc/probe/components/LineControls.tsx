"use client";

import type { ProbeDirection } from "../selection";
import styles from "./LineControls.module.css";

export interface LineControlsProps {
  chartTitle: string;
  direction: ProbeDirection;
  active: boolean;
  disabled?: boolean;
  onDirection: (direction: ProbeDirection) => void;
  onReset: () => void;
}

const OPTIONS: ReadonlyArray<{ value: ProbeDirection; label: string; hint: string }> = [
  { value: "below", label: "Below", hint: "the part under the line" },
  { value: "above", label: "Above", hint: "the part over the line" },
];

/** Card-header controls for one chart's probe line: which side it selects, and reset. */
export function LineControls({ chartTitle, direction, active, disabled, onDirection, onReset }: LineControlsProps) {
  return (
    <div className={styles.root}>
      <div role="group" aria-label={`${chartTitle} probe line selects`} className={styles.switch}>
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={styles.option}
            aria-pressed={direction === o.value}
            title={`Select ${o.hint}`}
            disabled={disabled}
            onClick={() => onDirection(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {active && (
        <button type="button" className={styles.reset} onClick={onReset} aria-label={`Reset the ${chartTitle} probe line`}>
          Reset
        </button>
      )}
    </div>
  );
}
