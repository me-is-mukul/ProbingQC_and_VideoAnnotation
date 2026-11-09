import { getServices } from "@/lib/server/container";
import { handle, notFound } from "@/lib/server/http";
import { createJobEventStream, SSE_HEADERS } from "@/lib/server/jobs/event-stream";
import { isId } from "@/lib/shared/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * `GET /api/jobs/:id/events` — Server-Sent Events. One long-lived response per viewer
 * instead of polling; resumes from `Last-Event-ID` (or `?after=`) after a reconnect.
 */
export const GET = handle(async (request: Request, context: Context) => {
  const { id } = await context.params;
  if (!isId(id)) throw notFound("Job");
  const { jobs } = await getServices();
  await jobs.require(id);

  const header = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after");
  const afterSeq = header && /^\d+$/.test(header) ? Number(header) : 0;
  return new Response(createJobEventStream(jobs, id, afterSeq, request.signal), { headers: SSE_HEADERS });
});
