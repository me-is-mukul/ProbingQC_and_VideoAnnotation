/**
 * Port of src/probing_qc/qc/stats.py. Same names, same edge cases, same rounding.
 * Boolean masks are Uint8Array (0/1).
 */

import type { Distribution } from "@/lib/shared/types";

import { mean, percentileLinear, pyRound, std } from "./numeric";

/** `summarize(values, decimals=4)`: NaNs ignored; all-null stats when nothing is left. */
export function summarize(values: ArrayLike<number>, decimals = 4): Distribution {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (!Number.isNaN(v)) finite.push(v);
  }
  if (finite.length === 0) return { mean: null, std: null, min: null, p5: null, p50: null, p95: null, max: null };
  const v = Float64Array.from(finite);
  const sorted = Float64Array.from(finite).sort();
  const r = (x: number) => pyRound(x, decimals);
  return {
    mean: r(mean(v)),
    std: r(std(v)),
    min: r(sorted[0]!),
    p5: r(percentileLinear(sorted, 5)),
    p50: r(percentileLinear(sorted, 50)),
    p95: r(percentileLinear(sorted, 95)),
    max: r(sorted[sorted.length - 1]!),
  };
}

/** Percentage of true values, 2 decimals (0 for an empty mask). */
export function pct(mask: ArrayLike<number>): number {
  if (mask.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) count += 1;
  return pyRound(100.0 * (count / mask.length), 2);
}

/** (start, end) index pairs, end exclusive, of each run of true values. */
export function runs(mask: ArrayLike<number>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, mask.length]);
  return out;
}

export function not(mask: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) out[i] = mask[i] ? 0 : 1;
  return out;
}

/** Set interior false runs of length ≤ `maxGap` to true. */
export function fillGaps(mask: ArrayLike<number>, maxGap: number): Uint8Array {
  const m = Uint8Array.from(mask, (v) => (v ? 1 : 0));
  if (maxGap <= 0) return m;
  for (const [start, end] of runs(not(m))) {
    if (start > 0 && end < m.length && end - start <= maxGap) m.fill(1, start, end);
  }
  return m;
}

/** Set true runs shorter than `minLen` to false. */
export function dropShort(mask: ArrayLike<number>, minLen: number): Uint8Array {
  const m = Uint8Array.from(mask, (v) => (v ? 1 : 0));
  for (const [start, end] of runs(m)) {
    if (end - start < minLen) m.fill(0, start, end);
  }
  return m;
}

/** Mean direction of angles in degrees in [0, 360); null for no angles; NaN in -> NaN out. */
export function circularMeanDeg(degrees: ArrayLike<number>): number | null {
  const n = degrees.length;
  if (n === 0) return null;
  const sin = new Float64Array(n);
  const cos = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = degrees[i]! * (Math.PI / 180);
    sin[i] = Math.sin(r);
    cos[i] = Math.cos(r);
  }
  const deg = Math.atan2(mean(sin), mean(cos)) * (180 / Math.PI);
  const m = deg % 360; // Python float %: the result takes the divisor's sign
  return m < 0 ? m + 360 : m === 0 ? 0 : m;
}
