/**
 * Cutting the IMU table with the same red portions as the video. Shared by the browser
 * (which decides what to remove) and the API (which streams the filtered CSV).
 *
 * IMU rows carry `timestamp_s`, seconds since the start of the recording (GPMF STMP).
 * For an untrimmed GoPro file that is the video's own timeline, so a sample is removed
 * exactly when its timestamp falls inside a removed interval. Each kept row also gets
 * `probed_time_s`: where that moment lands in the probed (cut) video.
 */

import { err, ok, type Result } from "../result";
import { isNormalized, type Interval } from "./intervals";

/** Upper bound on removed intervals in one request (each is a few dozen bytes of JSON). */
export const MAX_REMOVED_INTERVALS = 100_000;

/**
 * True when IMU timestamps fall on the video's own timeline. Trimmed clips keep the
 * original recording's GPMF timestamps (e.g. starting at 600 s), so seeking would miss
 * and a cut by video time would remove the wrong samples.
 */
export function imuAlignedWithVideo(imuT: ReadonlyArray<number | null>, videoDuration: number): boolean {
  const first = imuT.find((v): v is number => typeof v === "number");
  return first !== undefined && first > -1 && first < Math.max(1, videoDuration);
}

/** Validate `{ removed: [[start_s, end_s], ...] }` (normalised, non-negative, bounded). */
export function parseRemovedSeconds(body: unknown): Result<Interval[]> {
  const removed = (body as { removed?: unknown } | null)?.removed;
  if (!Array.isArray(removed)) return err("Body must be { removed: [[start_s, end_s], ...] }.");
  if (removed.length === 0) return err("Nothing is removed; download the original IMU CSV instead.");
  if (removed.length > MAX_REMOVED_INTERVALS) return err(`At most ${MAX_REMOVED_INTERVALS} intervals are allowed.`);
  const out: Interval[] = [];
  for (const item of removed) {
    if (!Array.isArray(item) || item.length !== 2 || !item.every((v) => typeof v === "number" && Number.isFinite(v))) {
      return err("Each interval must be [start_s, end_s] with finite numbers.");
    }
    out.push([item[0] as number, item[1] as number]);
  }
  if (out[0]![0] < 0) return err("Intervals must not start before 0 s.");
  if (!isNormalized(out)) return err("Intervals must be sorted, non-empty and non-overlapping.");
  return ok(out);
}

/**
 * Walks a normalised removed set with non-decreasing times in amortised O(1) per call
 * (IMU rows are sorted by time). Out-of-order times fall back to a rescan.
 */
export class RemovedCursor {
  private index = 0;
  private before = 0; // removed length of intervals[0 .. index)
  private lastT = -Infinity;

  constructor(private readonly removed: readonly Interval[]) {}

  /** Whether `t` is removed, and where it lands on the probed timeline. */
  at(t: number): { removed: boolean; probedTime: number } {
    if (t < this.lastT) {
      this.index = 0;
      this.before = 0;
    }
    this.lastT = t;
    while (this.index < this.removed.length && this.removed[this.index]![1] <= t) {
      const [a, b] = this.removed[this.index]!;
      this.before += b - a;
      this.index += 1;
    }
    const current = this.removed[this.index];
    const inside = current !== undefined && t >= current[0];
    return { removed: inside, probedTime: inside ? current[0] - this.before : t - this.before };
  }
}
