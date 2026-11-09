import { getServices } from "@/lib/server/container";
import { badRequest, handle, json, readJson } from "@/lib/server/http";
import { validateCreateJobRequest } from "@/lib/shared/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `POST /api/jobs` — start processing an uploaded file or a URL. */
export const POST = handle(async (request: Request) => {
  const { jobs, config } = await getServices();
  const parsed = validateCreateJobRequest(await readJson(request), { allowPrivate: config.allowPrivateUrls });
  if (!parsed.ok) throw badRequest(parsed.error);
  const job = await jobs.create(parsed.value);
  return json({ job }, { status: 201 });
});
