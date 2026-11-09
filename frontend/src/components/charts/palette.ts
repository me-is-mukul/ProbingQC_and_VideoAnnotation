/**
 * Categorical series colours, assigned in this fixed order (never cycled, never by rank).
 * Validated with the dataviz palette validator on the #111111 chart surface:
 * all-pairs CVD ΔE ≥ 12.0, normal-vision ΔE ≥ 20.9, contrast ≥ 3:1. Three slots maximum:
 * a fourth series must be folded or faceted, not given a new hue.
 */
export const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"] as const;

export type SeriesSlot = 0 | 1 | 2;

export function seriesColor(slot: SeriesSlot): string {
  return SERIES_COLORS[slot];
}
