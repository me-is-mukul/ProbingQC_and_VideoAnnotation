/**
 * Port of src/probing_qc/qc/hands/hoi.py: the report's hand-object interaction block.
 * Same arithmetic in the same order, so results equal Python's to the last digit
 * (probe-parity.json). Masks are 0/1 per analysed frame.
 */

import type { HoiMetrics } from "@/lib/shared/types";

import { pyRound } from "./numeric";
import { and, countTrue, longestRun, not, or, pct } from "./stats";

/** `100 * count(part) / count(whole)`, 2 decimals; null when `whole` has no true value. */
export function sharePct(part: ArrayLike<number>, whole: ArrayLike<number>): number | null {
  const w = countTrue(whole);
  return w ? pyRound((100.0 * countTrue(part)) / w, 2) : null;
}

/** `(R - L) / (R + L)` over contact frames, 3 decimals; null without contact. */
export function lateralityIndex(leftContact: ArrayLike<number>, rightContact: ArrayLike<number>): number | null {
  const l = countTrue(leftContact);
  const r = countTrue(rightContact);
  return r + l ? pyRound((r - l) / (r + l), 3) : null;
}

/** Events per minute of analysed time (`frames * dt` seconds); null for no time. */
export function perMinute(count: number, frames: number, dt: number): number | null {
  const seconds = frames * dt;
  return seconds > 0 ? pyRound((60.0 * count) / seconds, 2) : null;
}

/** `hoi_metrics`: presence per hand, cleaned contact masks, grasp count of both hands. */
export function hoiMetrics(
  left: ArrayLike<number>, right: ArrayLike<number>,
  leftContact: ArrayLike<number>, rightContact: ArrayLike<number>,
  grasps: number, dt: number,
): HoiMetrics {
  const either = or(left, right);
  const contact = or(leftContact, rightContact);
  const perHand = (present: ArrayLike<number>, mask: ArrayLike<number>) => ({
    contact_pct: pct(mask),
    contact_while_visible_pct: sharePct(and(mask, present), present),
  });
  return {
    bimanual_pct: pct(and(leftContact, rightContact)),
    idle_hands_pct: pct(and(either, not(contact))),
    contact_while_visible_pct: sharePct(and(either, contact), either),
    grasps_per_min: perMinute(grasps, either.length, dt),
    longest_no_contact_s: pyRound(longestRun(not(contact)) * dt, 2),
    laterality_index: lateralityIndex(leftContact, rightContact),
    per_hand: { left: perHand(left, leftContact), right: perHand(right, rightContact) },
  };
}
