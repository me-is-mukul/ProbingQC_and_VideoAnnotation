/**
 * Pure chart maths: scales, nice ticks, nearest-point lookup and SVG path building.
 * No React, no DOM, so every function here is unit-tested directly.
 */

export type Numeric = number | null | undefined;

export interface LinearScale {
  (value: number): number;
  invert(pixel: number): number;
  domain: [number, number];
  range: [number, number];
}

export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1; // flat domain -> map everything to r0 instead of NaN
  const scale = ((v: number) => r0 + ((v - d0) / span) * (r1 - r0)) as LinearScale;
  scale.invert = (p: number) => d0 + ((p - r0) / (r1 - r0 || 1)) * span;
  scale.domain = domain;
  scale.range = range;
  return scale;
}

/** [min, max] over all finite values, or null when there are none. */
export function extent(...series: ReadonlyArray<ReadonlyArray<Numeric>>): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const values of series) {
    for (const v of values) {
      if (typeof v === "number" && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  return min === Infinity ? null : [min, max];
}

function niceStep(rawStep: number): number {
  const power = 10 ** Math.floor(Math.log10(rawStep));
  // Tolerance: (1.08 - 0.98) / 4 is 0.025000000000000022, which must still count as 2.5.
  const fraction = rawStep / power - 1e-9;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * Round tick values (1, 2, 2.5, 5 × 10ⁿ) covering [min, max]; the domain is expanded to
 * the outer ticks so lines never touch the plot edge. A flat input gets a ±1 band.
 */
export function niceTicks(min: number, max: number, count = 5): { ticks: number[]; domain: [number, number] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], domain: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const step = niceStep((max - min) / Math.max(1, count));
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { ticks, domain: [ticks[0]!, ticks[ticks.length - 1]!] };
}

const TIME_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];

/** Tick positions in seconds at a human time step (1 s, 5 s, 1 min, 15 min, ...). */
export function timeTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return Number.isFinite(min) ? [min] : [];
  const raw = (max - min) / Math.max(1, count);
  const step = TIME_STEPS.find((s) => s >= raw) ?? Math.ceil(raw / 3600) * 3600;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

/** Index of the point whose x is closest to `x`; `xs` must be ascending. -1 if empty. */
export function nearestIndex(xs: ReadonlyArray<Numeric>, x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const v = xs[mid];
    if (typeof v === "number" && v < x) lo = mid + 1;
    else hi = mid;
  }
  const prev = lo - 1;
  const a = xs[prev];
  const b = xs[lo];
  if (prev >= 0 && typeof a === "number" && (typeof b !== "number" || Math.abs(a - x) <= Math.abs(b - x))) return prev;
  return lo;
}

/**
 * SVG path through (xs[i], ys[i]); a null/NaN in either breaks the line into a new
 * segment, so missing data shows as a gap instead of a false interpolation.
 */
export function linePath(xs: ReadonlyArray<Numeric>, ys: ReadonlyArray<Numeric>, sx: (v: number) => number, sy: (v: number) => number): string {
  let d = "";
  let pen = false;
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Closed area under each segment of the line, down to `baseline` (in data units). */
export function areaPath(xs: ReadonlyArray<Numeric>, ys: ReadonlyArray<Numeric>, sx: (v: number) => number, sy: (v: number) => number, baseline: number): string {
  let d = "";
  let segment: Array<[number, number]> = [];
  const flush = () => {
    if (segment.length > 1) {
      const base = sy(baseline).toFixed(1);
      d += `M${segment[0]![0].toFixed(1)},${base}`;
      for (const [x, y] of segment) d += `L${x.toFixed(1)},${y.toFixed(1)}`;
      d += `L${segment[segment.length - 1]![0].toFixed(1)},${base}Z`;
    }
    segment = [];
  };
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) flush();
    else segment.push([sx(x), sy(y)]);
  }
  flush();
  return d;
}

/** Last index holding a finite value (for the end marker), or -1. */
export function lastFiniteIndex(values: ReadonlyArray<Numeric>): number {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) return i;
  }
  return -1;
}
