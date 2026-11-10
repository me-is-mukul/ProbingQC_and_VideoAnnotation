import fs from "node:fs/promises";

import { compressedResponse } from "@/lib/server/compress";
import { getServices } from "@/lib/server/container";
import { handle, notFound } from "@/lib/server/http";
import { isId } from "@/lib/shared/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * `GET /api/jobs/:id/results` — the compact, chart-ready results.json (~100-300 KB,
 * versus tens of MB of raw CSV), gzip-encoded when the client accepts it. Immutable once
 * written, so the browser caches it and a revisit costs no egress.
 */
export const GET = handle(async (request: Request, context: Context) => {
  const { id } = await context.params;
  if (!isId(id)) throw notFound("Job");
  const { jobs } = await getServices();
  const file = await jobs.resultsPath(id);
  const body = await fs.readFile(file, "utf8").catch(() => {
    throw notFound("Results");
  });
  return compressedResponse(request, body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});
