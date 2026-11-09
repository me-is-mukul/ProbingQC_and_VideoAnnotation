import { describe, expect, it } from "vitest";

import { makePreview, makeResults } from "../../../../tests/fixtures/results";
import {
  column, distributionDetail, handMeters, handTiles, imageMeters, imageTiles, imuAlignedWithVideo, integrityFlags,
  ordinal, overviewTiles, rollingMean, scale, windowFor, windowLabel,
} from "./selectors";

describe("selectors", () => {
  const r = makeResults();

  it("builds the overview tiles", () => {
    const tiles = Object.fromEntries(overviewTiles(r).map((t) => [t.label, t]));
    expect(tiles.Duration).toMatchObject({ value: "1 h 21 min", detail: "145,920 frames" });
    expect(tiles.Resolution).toMatchObject({ value: "1920 × 1080", detail: "29.97 fps · landscape" });
    expect(tiles.Codec).toMatchObject({ value: "HEVC", detail: "Main · yuvj420p" });
    expect(tiles.Bitrate).toMatchObject({ value: "13.99 Mbit/s", detail: "File 8.67 GB" });
    expect(tiles.Analysed).toMatchObject({ value: "74 frames", detail: "Every 4th frame · 10:00 – 10:10" });
  });

  it("flags a clean run as good (±1 frame at window edges is normal)", () => {
    expect(integrityFlags(r).map((f) => f.status)).toEqual(["good", "good", "good", "good"]);
  });

  it("flags decode errors, missing frames, absent telemetry and failed checks", () => {
    const bad = makeResults({
      video: { ...r.video, has_gpmf: false },
      report: {
        ...r.report,
        technical: { ...r.report.technical, decode_errors: { count: 3, ffmpeg_exit_code: 1, frames_expected: 75, frames_decoded: 40, messages: ["[hevc] error"] } },
      },
      imu: { ...r.imu!, checks: [{ name: "gyro_bias", passed: false, value: 0.2, expected: "< 0.05" }] },
    });
    expect(integrityFlags(bad).map((f) => [f.status, f.label])).toEqual([
      ["critical", "3 decode errors"],
      ["warning", "Missing frames"],
      ["neutral", "No GPMF telemetry"],
      ["warning", "1 IMU check failed"],
    ]);
  });

  it("omits the IMU flag when there is no IMU block", () => {
    expect(integrityFlags(makeResults({ imu: null }))).toHaveLength(3);
  });

  it("formats windows, ordinals and distributions", () => {
    expect(windowLabel({ ...r.report.sampling, start_s: 0, max_seconds: null })).toBe("0:00 – end");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 112].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "112th"]);
    expect(distributionDetail(r.report.technical.luminance)).toBe("p5 94.8 · median 98.3 · p95 101.8");
  });

  it("builds image and hand views", () => {
    expect(imageTiles(r.report.technical).find((t) => t.label === "Colour cast")?.value).toBe("None");
    expect(imageMeters(r.report.technical).map((m) => m.value)).toEqual([0, 0, 0, 0]);
    expect(handMeters(r.report.hands!).map((m) => m.value)).toEqual([97.3, 81.08, 62.16]);
    expect(handTiles(r.report.hands!)[0]).toMatchObject({ value: "5", detail: "Left 4 · right 1" });
  });

  it("smooths 0/1 flags into a rolling share, ignoring gaps", () => {
    expect(rollingMean([0, 100, 0, 100], 1)).toEqual([0, 100, 0, 100]);
    expect(rollingMean([0, 100, 0, 100, 100], 3)).toEqual([50, 100 / 3, 200 / 3, 200 / 3, 100]);
    expect(rollingMean([null, null, 100], 2)).toEqual([null, null, 100]);
    expect(rollingMean([], 5)).toEqual([]);
  });

  it("derives the smoothing window from the sample spacing", () => {
    expect(windowFor([0, 0.1, 0.2, 0.3], 1)).toBe(10);
    expect(windowFor([0, 5, 10], 1)).toBe(1);   // already coarser than 1 s
    expect(windowFor([0], 1)).toBe(1);
  });

  it("detects IMU timelines that don't match the video (trimmed clips)", () => {
    expect(imuAlignedWithVideo([0.01, 0.02], 20)).toBe(true);
    expect(imuAlignedWithVideo([600, 600.5], 20)).toBe(false);
    expect(imuAlignedWithVideo([null], 20)).toBe(false);
  });

  it("reads preview columns safely", () => {
    const p = makePreview(3, { a: (i) => i });
    expect(column(p, "a")).toEqual([0, 1, 2]);
    expect(column(p, "missing")).toEqual([null, null, null]);
    expect(scale([0.5, null], 100)).toEqual([50, null]);
  });
});
