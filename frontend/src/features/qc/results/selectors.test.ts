import { describe, expect, it } from "vitest";

import { legacyHandMetrics, makePreview, makeResults } from "../../../../tests/fixtures/results";
import {
  column, distributionDetail, dominantHand, handsSwapped, hoiMeters, hoiTiles, imageMeters, imageTiles, integrityFlags,
  ordinal, overviewTiles, rollingMean, scale, schemaAtLeast, trackingMeters, trackingTiles, windowFor, windowLabel,
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
    const h = r.report.hands!;
    expect(trackingMeters(h).map((m) => m.value)).toEqual([97.3, 81.08, 89.19, 89.19]);
    expect(trackingTiles(h)[0]).toMatchObject({ value: "0", detail: "Left 1 · right 1" });
    expect(hoiMeters(h).map((m) => m.value)).toEqual([62.16, 63.89, 1.35, 35.14]);
    const tiles = Object.fromEntries(hoiTiles(h).map((t) => [t.label, t]));
    expect(Object.keys(tiles)).toEqual([
      "Grasp rate", "Mean grasp", "Dominant hand", "Left hand in contact", "Right hand in contact", "Longest without contact",
    ]);
    expect(tiles["Grasp rate"]).toMatchObject({ value: "30.4 / min", detail: "5 grasps: left 4 · right 1" });
    expect(tiles["Dominant hand"]).toMatchObject({ value: "Left", detail: "Contact time: left 85% · right 15%" });
    expect(tiles["Right hand in contact"]).toMatchObject({ value: "9.5%", detail: "10.6% of its visible time" });
  });

  it("shows only the original interaction figures for reports without the HOI block", () => {
    const legacy = legacyHandMetrics();
    expect(hoiMeters(legacy)).toHaveLength(1);
    expect(hoiTiles(legacy).map((t) => [t.label, t.value, t.detail])).toEqual([
      ["Grasps", "5", "Left 4 · right 1"], ["Mean grasp", "1.3 s", "Longest 2.3 s"],
    ]);
  });

  it("names the dominant hand from the laterality index", () => {
    expect(dominantHand(null)).toEqual({ value: "—", detail: "No contact" });
    expect(dominantHand(0.539)).toEqual({ value: "Right", detail: "Contact time: left 23% · right 77%" });
    expect(dominantHand(-0.08).value).toBe("Balanced");
    expect(dominantHand(-1).detail).toBe("Contact time: left 100% · right 0%");
  });

  it("warns that hands are swapped only in reports made before schema 1.2", () => {
    expect(handsSwapped(r.report)).toBe(false);
    expect(handsSwapped({ ...r.report, schema_version: "1.1" })).toBe(true);
    expect(handsSwapped({ ...r.report, schema_version: "1.0", hands: undefined })).toBe(false); // no hands, nothing swapped
    expect(handsSwapped({ ...r.report, schema_version: "2.0" })).toBe(false);
    expect([schemaAtLeast("1.10", "1.2"), schemaAtLeast("1.2", "1.2"), schemaAtLeast("0.9", "1.2"), schemaAtLeast("x", "1.2")])
      .toEqual([true, true, false, false]);
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

  it("reads preview columns safely", () => {
    const p = makePreview(3, { a: (i) => i });
    expect(column(p, "a")).toEqual([0, 1, 2]);
    expect(column(p, "missing")).toEqual([null, null, null]);
    expect(scale([0.5, null], 100)).toEqual([50, null]);
  });
});
