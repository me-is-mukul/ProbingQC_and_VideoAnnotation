import "server-only";

import type { ApiErrorBody } from "@/lib/shared/types";

/** An error with an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string) => new ApiError(400, "bad_request", message);
export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);
export const conflict = (message: string) => new ApiError(409, "conflict", message);

export function json<T>(body: T, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers as Record<string, string> | undefined) },
  });
}

export function errorResponse(error: unknown): Response {
  const apiError = error instanceof ApiError ? error : null;
  if (!apiError) console.error("[api] unexpected error", error);
  const body: ApiErrorBody = {
    error: apiError
      ? { code: apiError.code, message: apiError.message }
      : { code: "internal", message: "Something went wrong on the server." },
  };
  return json(body, { status: apiError?.status ?? 500 });
}

/** Wrap a route handler so thrown errors become JSON error responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw badRequest("Request body is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
}
