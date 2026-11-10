import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { makeJobService, streamOf } from "../../../../tests/helpers/server";
import { ImuCsvFilter, filterImuCsv, isImuHeader } from "./imu-filter";

const HEADER = "timestamp_s,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z";
const row = (t: number) => `${t.toFixed(6)},0.1,9.8,0.2,0.01,0.02,0.03`;

describe("IMU CSV filter", () => {
  it("drops rows in removed intervals and adds probed_time_s", () => {
    const f = new ImuCsvFilter([[1, 2], [3, 4]]);
    const input = [HEADER, row(0.5), row(1), row(1.5), row(2), row(3.5), row(4.25)].join("\n");
    const out = f.push(input) + f.flush();
    expect(out.split("\n").filter(Boolean)).toEqual([
      `${HEADER},probed_time_s`,
      `${row(0.5)},0.500000`,
      `${row(2)},1.000000`,          // 1 s removed before it
      `${row(4.25)},2.250000`,       // 2 s removed before it
    ]);
  });

  it("handles chunks that split lines and CRLF line ends", () => {
    const text = `${HEADER}\r\n${row(0)}\r\n${row(1.5)}\r\n${row(2.5)}\r\n`;
    const f = new ImuCsvFilter([[1, 2]]);
    let out = "";
    for (let i = 0; i < text.length; i += 7) out += f.push(text.slice(i, i + 7));
    out += f.flush();
    expect(out).toBe(`${HEADER},probed_time_s\n${row(0)},0.000000\n${row(2.5)},1.500000\n`);
  });

  it("rejects a file that is not the IMU table and rows without a timestamp", () => {
    expect(isImuHeader(HEADER)).toBe(true);
    expect(isImuHeader("frame,timestamp_s")).toBe(false);
    expect(() => new ImuCsvFilter([[0, 1]]).push("frame,luminance\n")).toThrow(/timestamp_s/);
    expect(() => new ImuCsvFilter([[0, 1]]).push(`${HEADER}\nabc,1,2\n`)).toThrow(/row 2/);
  });

  it("streams a text source and surfaces errors", async () => {
    async function* source(...chunks: string[]) {
      yield* chunks;
    }
    const stream = filterImuCsv(source(`${HEADER}\n${row(0)}\n`, `${row(5)}\n${row(7)}`), [[4, 6]]);
    expect(await new Response(stream).text()).toBe(`${HEADER},probed_time_s\n${row(0)},0.000000\n${row(7)},5.000000\n`);
    await expect(new Response(filterImuCsv(source("nope\n"), [[0, 1]])).text()).rejects.toThrow();
  });
});

describe("JobService outputs", () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  async function finishedJob(files: Record<string, string | null>) {
    const ctx = await makeJobService();
    cleanups.push(ctx.dataDir);
    const upload = await ctx.uploads.save(streamOf("bytes"), "GX010191.MP4");
    const job = await ctx.service.create({ source: { kind: "upload", uploadId: upload.uploadId }, options: { hands: true, imu: true } });
    await expect(ctx.service.outputPath(job.id, "frames_csv")).rejects.toMatchObject({ status: 409 });
    await vi.waitFor(() => expect(ctx.runner.started).toHaveLength(1));
    const jobDir = ctx.paths.jobDir(job.id);
    await fs.mkdir(path.join(jobDir, "outputs"), { recursive: true });
    await fs.writeFile(path.join(jobDir, "outputs", "GX010191_qc_frames.csv"), "frame\n0\n");
    await fs.writeFile(path.join(jobDir, "results.json"), JSON.stringify({ schema_version: "1.1", files }));
    ctx.runner.last.exit(0);
    await vi.waitFor(async () => expect((await ctx.service.get(job.id))?.status).toBe("succeeded"));
    return { ...ctx, job, jobDir };
  }

  it("resolves outputs listed in results.json inside the job folder", async () => {
    const { service, job, jobDir } = await finishedJob({ frames_csv: "outputs/GX010191_qc_frames.csv", imu_csv: null });
    expect(await service.outputPath(job.id, "frames_csv")).toBe(path.join(jobDir, "outputs", "GX010191_qc_frames.csv"));
    expect((await service.readResults(job.id)).schema_version).toBe("1.1");
    await expect(service.outputPath(job.id, "imu_csv")).rejects.toMatchObject({ status: 404 });
  });

  it("never serves a path outside the job folder, or a missing file", async () => {
    const escaping = await finishedJob({ frames_csv: "../../uploads/x", imu_csv: "outputs/missing.csv" });
    await expect(escaping.service.outputPath(escaping.job.id, "frames_csv")).rejects.toMatchObject({ status: 404 });
    await expect(escaping.service.outputPath(escaping.job.id, "imu_csv")).rejects.toMatchObject({ status: 404 });
  });
});
