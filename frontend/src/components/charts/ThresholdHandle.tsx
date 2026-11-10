"use client";

import { useRef } from "react";

import styles from "./ThresholdHandle.module.css";

export interface ThresholdHandleProps {
  /** Accessible name, e.g. "Probe line for Luminance". */
  label: string;
  /** Pixel position of the line inside the plot container. */
  y: number;
  /** Right edge of the plot in px (the handle sits at the end of the line). */
  right: number;
  /** Text inside the pill, e.g. "< 40.0". */
  text: string;
  /** Spoken value, e.g. "Selects frames below 40.0". */
  valueText: string;
  value: number;
  min: number;
  max: number;
  active: boolean;
  disabled?: boolean;
  /** Convert a pointer's clientY to a data value (clamped by the caller). */
  valueAt: (clientY: number) => number;
  onChange: (value: number) => void;
}

/**
 * The draggable pill at the end of a chart's threshold line. A real focusable slider
 * (role="slider"): drag it, or use ↑/↓ (1 % of the range), Shift or Page Up/Down (10 %),
 * Home/End. Lives outside the aria-hidden SVG so assistive technology can reach it.
 */
export function ThresholdHandle({
  label, y, right, text, valueText, value, min, max, active, disabled, valueAt, onChange,
}: ThresholdHandleProps) {
  const dragging = useRef(false);
  const span = max - min || 1;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const big = span / 10;
    const small = span / 100;
    const next: Record<string, number> = {
      ArrowUp: value + (e.shiftKey ? big : small),
      ArrowRight: value + (e.shiftKey ? big : small),
      ArrowDown: value - (e.shiftKey ? big : small),
      ArrowLeft: value - (e.shiftKey ? big : small),
      PageUp: value + big,
      PageDown: value - big,
      Home: min,
      End: max,
    };
    if (e.key in next) {
      e.preventDefault();
      e.stopPropagation();
      onChange(clamp(next[e.key]!));
    }
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      className={styles.handle}
      data-active={active}
      style={{ top: y, left: right }}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
      }}
      onPointerMove={(e) => {
        if (dragging.current) onChange(clamp(valueAt(e.clientY)));
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <span className={styles.grip} aria-hidden="true" />
      {text}
    </div>
  );
}
