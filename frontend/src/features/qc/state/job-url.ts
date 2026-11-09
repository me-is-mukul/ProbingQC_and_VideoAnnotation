/**
 * The current job lives in the address bar (`/qc?job=<id>`), so a reload or a shared link
 * reopens it instead of losing a 40-minute run.
 */

import { isId } from "@/lib/shared/validation";

export const JOB_PARAM = "job";

/** The job id in a query string, or null when absent or malformed. */
export function jobIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get(JOB_PARAM);
  return isId(id) ? id : null;
}

/** The same path with `job` set (or removed when `id` is null); other params are kept. */
export function withJobId(href: string, id: string | null): string {
  const url = new URL(href, "http://local");
  if (id) url.searchParams.set(JOB_PARAM, id);
  else url.searchParams.delete(JOB_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Update the address bar without navigation or a history entry. */
export function replaceJobInLocation(id: string | null): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(window.history.state, "", withJobId(window.location.href, id));
}
