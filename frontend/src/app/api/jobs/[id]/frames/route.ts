import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";

import { compressedResponse } from "@/lib/server/compress";
import { getServices } from "@/lib/server/container";
import { handle, notFound } from "@/lib/server/http";
import { isId } from "@/lib/shared/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * `GET /api/jobs/:id/frames` — the per-frame QC table (CSV) the browser needs to probe:
 * exact frame numbers for every chart point and the values to recompute metrics on.
 * About 110 bytes per analysed frame (about 4× less gzip-encoded), and immutable once the
 * job has finished, so a revisit is served from the browser cache.
 */
export const GET = handle(async (request: Request, context: Context) => {
  const { id } = await context.params;
  if (!isId(id)) throw notFound("Job");
  const { jobs } = await getServices();
  const file = await jobs.outputPath(id, "frames_csv");
  const { size } = await fs.stat(file);
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  return compressedResponse(request, stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});
