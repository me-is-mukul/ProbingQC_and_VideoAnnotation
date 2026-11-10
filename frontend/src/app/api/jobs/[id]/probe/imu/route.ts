import { createReadStream } from "node:fs";
import fs from "node:fs/promises";

import { compressedResponse } from "@/lib/server/compress";
import { getServices } from "@/lib/server/container";
import { badRequest, conflict, handle, notFound, readJson } from "@/lib/server/http";
import { filterImuCsv, isImuHeader } from "@/lib/server/probe/imu-filter";
import { imuAlignedWithVideo, parseRemovedSeconds } from "@/lib/shared/probe/imu";
import { probeFileNames } from "@/lib/shared/probe/names";
import { isId } from "@/lib/shared/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Removed-interval lists can be long (one pair per red part); 8 MB is ~200k pairs. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

async function firstLine(file: string): Promise<string> {
  const handle = await fs.open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/)[0] ?? "";
  } finally {
    await handle.close();
  }
}

/**
 * `POST /api/jobs/:id/probe/imu` with `{ removed: [[start_s, end_s], ...] }` — the job's
 * IMU CSV without the rows whose timestamp falls in a removed interval, plus a
 * `probed_time_s` column. Streams row by row (the full table is tens of MB), so memory
 * stays flat; nothing is written to disk.
 */
export const POST = handle(async (request: Request, context: Context) => {
  const { id } = await context.params;
  if (!isId(id)) throw notFound("Job");
  const parsed = parseRemovedSeconds(await readJson(request, MAX_BODY_BYTES));
  if (!parsed.ok) throw badRequest(parsed.error);

  const { jobs } = await getServices();
  const results = await jobs.readResults(id);
  if (!results.imu) throw notFound("IMU data");
  if (!imuAlignedWithVideo(results.imu.preview.t, results.video.duration_s)) {
    throw conflict("This clip's IMU timestamps don't start with the video (trimmed clip), so the IMU can't be cut by video time.");
  }
  const file = await jobs.outputPath(id, "imu_csv");
  if (!isImuHeader(await firstLine(file))) throw conflict("The IMU file of this job has an unexpected format.");

  const stream = filterImuCsv(createReadStream(file, { encoding: "utf8" }), parsed.value);
  return compressedResponse(request, stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${probeFileNames(results.video.file).imu}"`,
      "Cache-Control": "no-store",
    },
  });
});
