/**
 * Fast (stream-copy) cutting can only start a kept part on a keyframe. This module moves
 * each kept part's start forward to the next keyframe, so the fast command never keeps a
 * frame the lines asked to remove (it removes slightly more instead), and decides whether
 * fast mode is possible at all.
 *
 * Verified with ffmpeg 8 on GoPro HEVC (no B-frames): every output frame is bit-identical
 * to the source frame the plan predicts. A kept part may end on any frame only when the
 * video has no B-frames; with B-frames the frames around an end point depend on frames
 * after it, so fast mode is disabled rather than approximated.
 */

import type { Interval, IntervalSet } from "@/lib/shared/probe/intervals";
import type { Keyframes, QCResults } from "@/lib/shared/types";

export type FastAvailability = { available: true; keyframes: number[] | "all" } | { available: false; reason: string };

export function fastAvailability(r: Pick<QCResults, "keyframes" | "video">): FastAvailability {
  const keyframes: Keyframes | undefined = r.keyframes;
  if (keyframes === undefined || r.video.has_b_frames === undefined) {
    return { available: false, reason: "These results predate the keyframe index. Run the analysis again to enable fast cuts." };
  }
  if (keyframes === null || (Array.isArray(keyframes) && keyframes.length === 0)) {
    return { available: false, reason: "The video's keyframes couldn't be read, so a lossless cut isn't possible." };
  }
  if (r.video.has_b_frames > 0) {
    return { available: false, reason: "This video uses B-frames, so a lossless cut can't end on an exact frame. Use Exact." };
  }
  return { available: true, keyframes };
}

/** Smallest keyframe ≥ `frame` (binary search over ascending frame numbers), or null. */
export function nextKeyframe(keyframes: readonly number[], frame: number): number | null {
  let lo = 0;
  let hi = keyframes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid]! < frame) lo = mid + 1;
    else hi = mid;
  }
  return lo < keyframes.length ? keyframes[lo]! : null;
}

/** Start every kept part on a keyframe; parts with no keyframe inside are dropped. */
export function snapKeptToKeyframes(kept: IntervalSet, keyframes: readonly number[] | "all"): Interval[] {
  if (keyframes === "all") return [...kept];
  const out: Interval[] = [];
  for (const [a, b] of kept) {
    const start = nextKeyframe(keyframes, a);
    if (start !== null && start < b) out.push([start, b]);
  }
  return out;
}
