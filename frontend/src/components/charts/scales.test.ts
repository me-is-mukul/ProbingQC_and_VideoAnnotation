import { describe, expect, it } from "vitest";

import { areaPath, extent, lastFiniteIndex, linearScale, linePath, nearestIndex, niceTicks, timeTicks } from "./scales";

describe("linearScale", () => {
  it("maps and inverts", () => {
    const s = linearScale([0, 10], [100, 200]);
    expect(s(5)).toBe(150);
    expect(s.invert(150)).toBe(5);
  });

  it("does not produce NaN for a flat domain", () => {
    const s = linearScale([3, 3], [0, 100]);
    expect(s(3)).toBe(0);
    expect(Number.isNaN(s.invert(50))).toBe(false);
  });
});

describe("extent", () => {
  it("ignores null, undefined, NaN and infinities", () => {
    expect(extent([3, null, 1, Number.NaN], [undefined, 7, Infinity])).toEqual([1, 7]);
    expect(extent([null], [])).toBeNull();
  });
});

describe("niceTicks", () => {
  it.each([
    [0, 255, 4, [0, 100, 200, 300]],
    [91.2, 107.4, 4, [90, 95, 100, 105, 110]],
    [0.98, 1.08, 4, [0.975, 1, 1.025, 1.05, 1.075, 1.1]],
    [-0.02, 0.015, 4, [-0.02, -0.01, 0, 0.01, 0.02]],
  ])("niceTicks(%d, %d)", (min, max, count, ticks) => {
    const r = niceTicks(min, max, count);
    expect(r.ticks).toEqual(ticks);
    expect(r.domain[0]).toBeLessThanOrEqual(min);
    expect(r.domain[1]).toBeGreaterThanOrEqual(max);
  });

  it("pads a flat series and tolerates non-finite input", () => {
    expect(niceTicks(5, 5).domain[0]).toBeLessThan(5);
    expect(niceTicks(0, 0).ticks.length).toBeGreaterThan(1);
    expect(niceTicks(Number.NaN, 1)).toEqual({ ticks: [0, 1], domain: [0, 1] });
  });
});

describe("timeTicks", () => {
  it("chooses human steps", () => {
    expect(timeTicks(0, 60, 6)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(timeTicks(600, 610, 5)).toEqual([600, 602, 604, 606, 608, 610]);
    expect(timeTicks(0, 4868, 6)).toEqual([0, 900, 1800, 2700, 3600, 4500]);
  });

  it("handles degenerate ranges", () => {
    expect(timeTicks(5, 5)).toEqual([5]);
    expect(timeTicks(Number.NaN, 1)).toEqual([]);
  });
});

describe("nearestIndex", () => {
  const xs = [0, 1, 2, 4, 8];
  it.each([
    [-5, 0], [0, 0], [0.4, 0], [0.6, 1], [3, 2], [3.1, 3], [100, 4],
  ])("x=%d -> %d", (x, i) => {
    expect(nearestIndex(xs, x)).toBe(i);
  });

  it("returns -1 for no points and 0 for one", () => {
    expect(nearestIndex([], 1)).toBe(-1);
    expect(nearestIndex([5], 1)).toBe(0);
  });
});

describe("paths", () => {
  const id = (v: number) => v;

  it("breaks the line at missing values", () => {
    expect(linePath([0, 1, 2, 3], [0, null, 2, 3], id, id)).toBe("M0.0,0.0M2.0,2.0L3.0,3.0");
    expect(linePath([], [], id, id)).toBe("");
  });

  it("closes each area segment on the baseline and skips single points", () => {
    expect(areaPath([0, 1, 2, 3], [5, 5, null, 7], id, id, 0)).toBe("M0.0,0.0L0.0,5.0L1.0,5.0L1.0,0.0Z");
  });

  it("finds the last finite value", () => {
    expect(lastFiniteIndex([1, 2, null, Number.NaN])).toBe(1);
    expect(lastFiniteIndex([null])).toBe(-1);
  });
});
