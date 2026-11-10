/**
 * Half-open interval sets: [start, end). Used in frame numbers (integers) for the probe
 * plan and in seconds for the IMU cut. Pure; shared by the browser and the API.
 *
 * Most functions take *normalised* sets (sorted, disjoint, non-adjacent, non-empty), the
 * form `normalize` returns and every function here returns.
 */

export type Interval = readonly [start: number, end: number];
export type IntervalSet = readonly Interval[];

/** Sort, drop empty or non-finite intervals, and merge overlapping or touching ones. */
export function normalize(intervals: Iterable<Interval>): Interval[] {
  const valid = [...intervals].filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);
  valid.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of valid) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** True when `set` is already normalised. */
export function isNormalized(set: IntervalSet): boolean {
  for (let i = 0; i < set.length; i += 1) {
    const [a, b] = set[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return false;
    if (i > 0 && a <= set[i - 1]![1]) return false;
  }
  return true;
}

/** a ∩ b. */
export function intersect(a: IntervalSet, b: IntervalSet): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const [a0, a1] = a[i]!;
    const [b0, b1] = b[j]!;
    const lo = Math.max(a0, b0);
    const hi = Math.min(a1, b1);
    if (hi > lo) out.push([lo, hi]);
    if (a1 < b1) i += 1;
    else j += 1;
  }
  return out;
}

/** Intersection of every set. An empty list of sets selects nothing (returns []). */
export function intersectAll(sets: readonly IntervalSet[]): Interval[] {
  if (sets.length === 0) return [];
  return sets.slice(1).reduce<Interval[]>((acc, s) => intersect(acc, s), [...sets[0]!]);
}

/** [lo, hi) minus `set`. */
export function complement(set: IntervalSet, lo: number, hi: number): Interval[] {
  const out: Interval[] = [];
  let cursor = lo;
  for (const [a, b] of set) {
    if (b <= cursor) continue;
    if (a >= hi) break;
    if (a > cursor) out.push([cursor, Math.min(a, hi)]);
    cursor = Math.max(cursor, b);
    if (cursor >= hi) break;
  }
  if (cursor < hi) out.push([cursor, hi]);
  return out;
}

/** Total covered length. */
export function totalLength(set: IntervalSet): number {
  let sum = 0;
  for (const [a, b] of set) sum += b - a;
  return sum;
}

/** Index of the interval containing `x` (start ≤ x < end), or -1. Binary search. */
export function indexContaining(set: IntervalSet, x: number): number {
  let lo = 0;
  let hi = set.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = set[mid]!;
    if (x < a) hi = mid - 1;
    else if (x >= b) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export function contains(set: IntervalSet, x: number): boolean {
  return indexContaining(set, x) >= 0;
}

/** Length of `set` that lies before `x`, i.e. |set ∩ (-∞, x)|. */
export function lengthBefore(set: IntervalSet, x: number): number {
  let sum = 0;
  for (const [a, b] of set) {
    if (a >= x) break;
    sum += Math.min(b, x) - a;
  }
  return sum;
}

/** Map every bound through `f` (e.g. frames -> seconds); `f` must be increasing. */
export function mapBounds(set: IntervalSet, f: (v: number) => number): Interval[] {
  return set.map(([a, b]) => [f(a), f(b)] as const);
}
