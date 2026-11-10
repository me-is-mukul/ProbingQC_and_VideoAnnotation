/**
 * Which frames a chart's probe line selects. A chart point is one preview bucket: a run of
 * `bucket_size` consecutive analysed frames, and each analysed frame stands for itself and
 * the `stride - 1` frames after it. So a point covers the source frames from its first
 * analysed frame up to the next point's first analysed frame.
 */

import { normalize, type Interval } from "@/lib/shared/probe/intervals";

export type ProbeDirection = "below" | "above";

export interface ProbeLine {
  value: number;
  direction: ProbeDirection;
}

/**
 * Source-frame range [start, end) of every chart point.
 * `frame` is the frame number of each analysed row (ascending), as in the frames CSV.
 */
export function pointFrameRanges(frame: ArrayLike<number>, bucketSize: number, frameCount: number, stride: number): Interval[] {
  const n = frame.length;
  if (n === 0) return [];
  const last = frame[n - 1]!;
  const tailEnd = Math.max(last + 1, Math.min(last + stride, frameCount));
  const ranges: Interval[] = [];
  for (let first = 0; first < n; first += bucketSize) {
    const next = first + bucketSize;
    ranges.push([frame[first]!, next < n ? frame[next]! : tailEnd]);
  }
  return ranges;
}

/** Strictly below / above. A point without a value (null) is never selected. */
export function isSelected(value: number | null | undefined, line: ProbeLine): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return line.direction === "below" ? value < line.value : value > line.value;
}

/** Frames whose chart point lies in the selected region of `line` (normalised). */
export function chartSelection(values: ReadonlyArray<number | null | undefined>, line: ProbeLine, ranges: readonly Interval[]): Interval[] {
  if (values.length !== ranges.length) throw new Error(`Chart has ${values.length} points but ${ranges.length} frame ranges`);
  const picked: Interval[] = [];
  for (let j = 0; j < values.length; j += 1) if (isSelected(values[j], line)) picked.push(ranges[j]!);
  return normalize(picked);
}
