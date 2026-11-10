/**
 * Browser-side API client. Every call to our own server goes through here, so the
 * endpoints and error handling live in one place.
 */

import { SUPPORTED_RESULTS_MAJOR } from "@/lib/shared/constants";
import type { ApiErrorBody, CreateJobRequest, Job, QCResults, UploadInfo } from "@/lib/shared/types";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function errorFromBody(status: number, body: unknown): ApiClientError {
  const e = (body as Partial<ApiErrorBody> | null)?.error;
  return new ApiClientError(status, e?.code ?? "http_error", e?.message ?? `Request failed (${status})`);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { Accept: "application/json", ...init.headers } });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiClientError(0, "network", "Can't reach the server. Check your connection and try again.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw errorFromBody(response.status, body);
  return body as T;
}

export const endpoints = {
  uploads: "/api/uploads",
  jobs: "/api/jobs",
  job: (id: string) => `/api/jobs/${encodeURIComponent(id)}`,
  events: (id: string) => `/api/jobs/${encodeURIComponent(id)}/events`,
  results: (id: string) => `/api/jobs/${encodeURIComponent(id)}/results`,
  video: (id: string) => `/api/jobs/${encodeURIComponent(id)}/video`,
  frames: (id: string) => `/api/jobs/${encodeURIComponent(id)}/frames`,
  probeImu: (id: string) => `/api/jobs/${encodeURIComponent(id)}/probe/imu`,
  health: "/api/health",
} as const;

export async function createJob(body: CreateJobRequest, signal?: AbortSignal): Promise<Job> {
  const { job } = await request<{ job: Job }>(endpoints.jobs, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return job;
}

export async function getJob(id: string, signal?: AbortSignal): Promise<Job> {
  const { job } = await request<{ job: Job }>(endpoints.job(id), { signal });
  return job;
}

export async function cancelJob(id: string): Promise<Job> {
  const { job } = await request<{ job: Job }>(endpoints.job(id), { method: "DELETE" });
  return job;
}

export async function fetchResults(id: string, signal?: AbortSignal): Promise<QCResults> {
  const results = await request<QCResults>(endpoints.results(id), { signal });
  const major = Number(String(results.schema_version).split(".")[0]);
  if (major !== SUPPORTED_RESULTS_MAJOR) {
    throw new ApiClientError(200, "unsupported_results", `Results format ${results.schema_version} is not supported by this version of the app.`);
  }
  return results;
}

/** The per-frame QC table (CSV text). Immutable once the job has finished, so it is cached. */
export async function fetchFramesCsv(id: string, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpoints.frames(id), { signal, headers: { Accept: "text/csv" } });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiClientError(0, "network", "Can't reach the server. Check your connection and try again.");
  }
  if (!response.ok) throw errorFromBody(response.status, await response.json().catch(() => null));
  return response.text();
}

/** The IMU CSV without the removed intervals (seconds), plus a `probed_time_s` column. */
export async function fetchProbedImu(id: string, removed: ReadonlyArray<readonly [number, number]>, signal?: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(endpoints.probeImu(id), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/csv" },
      body: JSON.stringify({ removed }),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiClientError(0, "network", "Can't reach the server. Check your connection and try again.");
  }
  if (!response.ok) throw errorFromBody(response.status, await response.json().catch(() => null));
  return response.blob();
}

export async function fetchHealth(): Promise<{ ok: boolean; problems: string[] }> {
  const response = await fetch(endpoints.health, { headers: { Accept: "application/json" } });
  return (await response.json()) as { ok: boolean; problems: string[] };
}

export interface UploadHandle {
  promise: Promise<UploadInfo>;
  abort(): void;
}

/**
 * Upload a file as a raw request body. XMLHttpRequest (not fetch) because only XHR reports
 * upload progress in every browser.
 */
export function uploadVideo(file: File, onProgress: (loaded: number, total: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadInfo>((resolve, reject) => {
    xhr.open("PUT", endpoints.uploads);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : file.size);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as UploadInfo);
      else reject(errorFromBody(xhr.status, xhr.response));
    };
    xhr.onerror = () => reject(new ApiClientError(0, "network", "The upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
