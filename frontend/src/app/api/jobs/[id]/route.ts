import { getServices } from "@/lib/server/container";
import { handle, json, notFound } from "@/lib/server/http";
import { isId } from "@/lib/shared/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function jobId(context: Context): Promise<string> {
  const { id } = await context.params;
  if (!isId(id)) throw notFound("Job");
  return id;
}

/** `GET /api/jobs/:id` — current job status. */
export const GET = handle(async (_request: Request, context: Context) => {
  const { jobs } = await getServices();
  return json({ job: await jobs.require(await jobId(context)) });
});

/** `DELETE /api/jobs/:id` — cancel a queued or running job. */
export const DELETE = handle(async (_request: Request, context: Context) => {
  const { jobs } = await getServices();
  return json({ job: await jobs.cancel(await jobId(context)) }, { status: 202 });
});
