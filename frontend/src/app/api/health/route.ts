import { configProblems, getConfig } from "@/lib/server/config";
import { handle, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + configuration check (used by the UI banner and by load-balancer health checks). */
export const GET = handle(async () => {
  const problems = configProblems(getConfig());
  return json({ ok: problems.length === 0, problems }, { status: problems.length ? 503 : 200 });
});
