import { describe, expect, it } from "vitest";

import parity from "../../../../tests/fixtures/probe-parity.json";
import { hoiMetrics, lateralityIndex, perMinute, sharePct } from "./hoi";
import { handMetrics, imageMetrics, secondsToFrames, type HandColumns, type ImageColumns } from "./metrics";

type Table = Record<string, Array<number | boolean | null>>;

const toColumn = (values: Array<number | boolean | null>) =>
  Float64Array.from(values, (v) => (v === null ? Number.NaN : typeof v === "boolean" ? Number(v) : v));

function columns(table: Table) {
  const c = Object.fromEntries(Object.entries(table).map(([k, v]) => [k, toColumn(v)]));
  return { image: c as unknown as ImageColumns, hands: c as unknown as HandColumns };
}

/**
 * probe-parity.json is written by tests/probe_parity.py from the real Python functions
 * (and kept current by tests/test_probe_parity.py). Equality is exact: the port mirrors
 * numpy's summation order and CPython's rounding.
 */
describe("metric port matches Python (probe-parity.json)", () => {
  const tables = parity.tables as unknown as Record<string, Table>;
  it.each(parity.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const cols = columns(tables[c.table]!);
    const rows = Int32Array.from(c.mask.flatMap((keep, i) => (keep ? [i] : [])));
    expect(imageMetrics(cols.image, rows, c.image_config)).toEqual(c.expected.image);
    expect(handMetrics(cols.hands, rows, c.dt, c.hand_config)).toEqual(c.expected.hands);
  });
});

describe("HOI helpers (qc/hands/hoi.py)", () => {
  const m = (...bits: number[]) => Uint8Array.from(bits);
  it("shares, laterality and rates, with null where Python gives None", () => {
    expect(sharePct(m(1, 0, 0), m(1, 1, 1))).toBe(33.33);
    expect(sharePct(m(0), m(0))).toBeNull();
    expect(lateralityIndex(m(1, 0, 0, 0), m(1, 1, 1, 0))).toBe(0.5);
    expect(lateralityIndex(m(0, 0), m(0, 0))).toBeNull();
    expect(perMinute(3, 30, 0.1)).toBe(60);
    expect(perMinute(3, 0, 0.1)).toBeNull();
  });

  it("matches the worked example in tests/test_qc_hands.py", () => {
    const left = m(1, 1, 1, 1, 0, 0, 0, 1, 1, 1);
    const right = m(0, 0, 1, 1, 1, 1, 0, 0, 0, 0);
    const leftMask = m(1, 1, 1, 1, 0, 0, 0, 0, 0, 0);
    expect(hoiMetrics(left, right, leftMask, m(0, 0, 0, 0, 0, 0, 0, 0, 0, 0), 1, 0.1)).toEqual({
      bimanual_pct: 0, idle_hands_pct: 50, contact_while_visible_pct: 44.44, grasps_per_min: 60,
      longest_no_contact_s: 0.6, laterality_index: -1,
      per_hand: { left: { contact_pct: 40, contact_while_visible_pct: 57.14 }, right: { contact_pct: 0, contact_while_visible_pct: 0 } },
    });
  });
});

describe("hand helpers", () => {
  it("rounds frame counts like CPython round() (values checked against CPython 3.13)", () => {
    expect(secondsToFrames(0.25, 0.1)).toBe(2);   // 0.25 / 0.1 = 2.5 exactly -> ties to even
    expect(secondsToFrames(0.35, 0.1)).toBe(3);   // 3.4999999999999996
    expect(secondsToFrames(-1, 0.1)).toBe(0);     // never negative
  });
});
