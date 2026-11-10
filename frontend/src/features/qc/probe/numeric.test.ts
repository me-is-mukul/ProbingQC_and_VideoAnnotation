import { describe, expect, it } from "vitest";

import { mean, pairwiseSum, percentileLinear, pyRound, pyRoundInt, std } from "./numeric";

describe("numpy-compatible numerics", () => {
  it("sums pairwise like numpy (block and recursion paths)", () => {
    // 0.1 summed 1000 times: naive left-to-right drifts; numpy's pairwise sum gives 100.00000000000001
    const tenths = new Float64Array(1000).fill(0.1);
    let naive = 0;
    for (const v of tenths) naive += v;
    expect(naive).not.toBe(pairwiseSum(tenths));
    expect(pairwiseSum(tenths)).toBe(100.00000000000001); // np.full(1000, 0.1).sum(), numpy 2.5
    expect(pairwiseSum([1, 2, 3])).toBe(6);
    expect(pairwiseSum([])).toBe(0);
    expect(pairwiseSum([1, 2, 3, 4], 1, 2)).toBe(5);
  });

  it("mean and population std", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });

  it("linear percentiles with numpy's lerp", () => {
    const s = [1, 2, 3, 4, 5];
    expect(percentileLinear(s, 50)).toBe(3);
    expect(percentileLinear(s, 5)).toBeCloseTo(1.2, 12);
    expect(percentileLinear(s, 95)).toBeCloseTo(4.8, 12);
    expect(percentileLinear([7], 95)).toBe(7);
    expect(percentileLinear([1, 3], 100)).toBe(3);
  });

  it("rounds like CPython round() (expected values from CPython 3.13)", () => {
    expect(pyRound(3.125, 2)).toBe(3.12);       // exact tie -> even
    expect(pyRound(-3.125, 2)).toBe(-3.12);
    expect(pyRound(2.675, 2)).toBe(2.67);       // 2.67499999... in binary
    expect(pyRound(0.03125, 4)).toBe(0.0312);
    expect(pyRound(81.03125, 4)).toBe(81.0312);
    expect(pyRound(2.5, 0)).toBe(2);
    expect(pyRound(1.23456, 4)).toBe(1.2346);
    expect(Number.isNaN(pyRound(Number.NaN, 2))).toBe(true);
    expect([2.5, 3.5, -2.5, 0.5, 1.5].map(pyRoundInt)).toEqual([2, 4, -2, 0, 2]);
    expect(pyRoundInt(2.4999999999999996)).toBe(2);
  });
});
