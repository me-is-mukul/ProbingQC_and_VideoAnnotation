import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { getServices } from "@/lib/server/container";
import { handle, notFound } from "@/lib/server/http";
import { contentRange, parseRange } from "@/lib/server/range";
import { isId } from "@/lib/shared/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const MIME: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime" };

/**
 * `GET /api/jobs/:id/video` — byte-range streaming of the processed video.
 * Fallback only: the UI plays uploads from the browser's own copy and URL sources from
 * their origin, because every byte served from here is billable egress.
 */
export const GET = handle(async (request: Request, context: Context) => {
  const { id } = await context.params;
  if (!isId(id)) throw notFound("Job");
  const { jobs } = await getServices();
  const file = await jobs.videoPath(id);
  const { size } = await fs.stat(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = parseRange(request.headers.get("range"), size);

  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      ...(range ? { "Content-Range": contentRange(range, size) } : {}),
    },
  });
});
