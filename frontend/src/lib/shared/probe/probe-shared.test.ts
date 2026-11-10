import { describe, expect, it } from "vitest";

import { imuAlignedWithVideo, MAX_REMOVED_INTERVALS, parseRemovedSeconds, RemovedCursor } from "./imu";
import {
  complement, contains, indexContaining, intersect, intersectAll, isNormalized, lengthBefore, mapBounds, normalize, totalLength,
} from "./intervals";
import { isShellSafe, probeFileNames, safeStem } from "./names";

describe("intervals", () => {
  it("normalises: sorts, merges overlapping and touching, drops empty and non-finite", () => {
    expect(normalize([[5, 7], [1, 3], [3, 4], [2, 2.5], [9, 9], [8, 6], [Number.NaN, 1], [10, Infinity]])).toEqual([[1, 4], [5, 7]]);
    expect(normalize([])).toEqual([]);
    expect(isNormalized([[1, 4], [5, 7]])).toBe(true);
    expect(isNormalized([[1, 4], [4, 7]])).toBe(false);   // touching must be merged
    expect(isNormalized([[5, 7], [1, 4]])).toBe(false);
    expect(isNormalized([[1, 1]])).toBe(false);
  });

  it("intersects (the |x| < 1 and x² < 4 example selects |x| < 1)", () => {
    const absBelow1 = [[-1, 1]] as const;
    const squareBelow4 = [[-2, 2]] as const;
    expect(intersect(absBelow1, squareBelow4)).toEqual([[-1, 1]]);
    expect(intersect([[0, 5], [10, 20]], [[3, 12], [15, 16], [19, 30]])).toEqual([[3, 5], [10, 12], [15, 16], [19, 20]]);
    expect(intersect([[0, 1]], [[1, 2]])).toEqual([]);
    expect(intersectAll([[[0, 10]], [[2, 8]], [[5, 20]]])).toEqual([[5, 8]]);
    expect(intersectAll([])).toEqual([]);
  });

  it("complements within bounds", () => {
    expect(complement([[2, 4], [6, 8]], 0, 10)).toEqual([[0, 2], [4, 6], [8, 10]]);
    expect(complement([], 0, 10)).toEqual([[0, 10]]);
    expect(complement([[0, 10]], 0, 10)).toEqual([]);
    expect(complement([[-5, 2], [9, 15]], 0, 10)).toEqual([[2, 9]]);
  });

  it("measures and searches", () => {
    const set = [[0, 2], [5, 6], [10, 15]] as const;
    expect(totalLength(set)).toBe(8);
    expect(indexContaining(set, 0)).toBe(0);
    expect(indexContaining(set, 2)).toBe(-1);   // end-exclusive
    expect(indexContaining(set, 14.9)).toBe(2);
    expect(contains(set, 5)).toBe(true);
    expect(lengthBefore(set, 5.5)).toBe(2.5);
    expect(lengthBefore(set, 100)).toBe(8);
    expect(mapBounds([[30, 60]], (f) => f / 30)).toEqual([[1, 2]]);
  });
});

describe("IMU cut", () => {
  it("detects IMU timelines that don't match the video (trimmed clips)", () => {
    expect(imuAlignedWithVideo([0.01, 0.02], 20)).toBe(true);
    expect(imuAlignedWithVideo([600, 600.5], 20)).toBe(false);
    expect(imuAlignedWithVideo([null], 20)).toBe(false);
  });

  it("validates removed intervals", () => {
    expect(parseRemovedSeconds({ removed: [[0, 1.5], [2, 3]] })).toEqual({ ok: true, value: [[0, 1.5], [2, 3]] });
    for (const bad of [null, {}, { removed: [] }, { removed: [[1]] }, { removed: [[1, "2"]] }, { removed: [[2, 1]] },
      { removed: [[0, 2], [1, 3]] }, { removed: [[-1, 1]] }, { removed: [[0, Infinity]] }]) {
      expect(parseRemovedSeconds(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    const tooMany = Array.from({ length: MAX_REMOVED_INTERVALS + 1 }, (_, i) => [i * 2, i * 2 + 1]);
    expect(parseRemovedSeconds({ removed: tooMany }).ok).toBe(false);
  });

  it("walks sorted timestamps: removed flag and time on the probed timeline", () => {
    const c = new RemovedCursor([[1, 2], [3, 5]]);
    expect(c.at(0.5)).toEqual({ removed: false, probedTime: 0.5 });
    expect(c.at(1)).toMatchObject({ removed: true });
    expect(c.at(1.99).removed).toBe(true);
    expect(c.at(2)).toEqual({ removed: false, probedTime: 1 });
    expect(c.at(4).removed).toBe(true);
    expect(c.at(5)).toEqual({ removed: false, probedTime: 2 });
    expect(c.at(9)).toEqual({ removed: false, probedTime: 6 });
    expect(c.at(2.5)).toEqual({ removed: false, probedTime: 1.5 }); // out of order: rescans
  });
});

describe("output names", () => {
  it("knows which names are safe to double-quote in every shell", () => {
    expect(isShellSafe("GX010191.MP4")).toBe(true);
    expect(isShellSafe("my clip (1).mp4")).toBe(true);
    for (const bad of ['a"b.mp4', "a$b.mp4", "a`b.mp4", "a!b.mp4", "50%.mp4", "a\\b.mp4", "-rf.mp4"]) expect(isShellSafe(bad), bad).toBe(false);
  });

  it("derives a safe stem and every output name from it", () => {
    expect(safeStem("GX010191.MP4")).toBe("GX010191");
    expect(safeStem("my clip (1).mp4")).toBe("my_clip_1_");
    expect(safeStem(".mp4")).toBe("video");
    expect(safeStem("--x.mov")).toBe("x");
    expect(probeFileNames("GX010191.MP4")).toEqual({
      output: "GX010191_probed.mp4", filterScript: "GX010191_probe_filter.txt", concatList: "GX010191_probe.ffconcat",
      plan: "GX010191_probe_plan.json", imu: "GX010191_imu_probed.csv",
    });
  });
});
