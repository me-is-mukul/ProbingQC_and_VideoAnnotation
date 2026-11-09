/**
 * Input validation shared by the browser (instant feedback) and the API (the authority).
 * Every function is pure and returns a Result instead of throwing.
 */

import { DEFAULT_JOB_OPTIONS, OPTION_LIMITS, VIDEO_EXTENSIONS } from "./constants";
import { err, ok, type Result } from "./result";
import type { CreateJobRequest, JobOptions } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Job and upload ids are server-generated UUID v4s; anything else is rejected (no path tricks). */
export function isId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function hasVideoExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * A safe single path segment for a user-supplied file name: directories stripped,
 * control and reserved characters replaced, length capped, extension kept.
 * Returns `null` when nothing usable remains or the extension is not a video.
 */
export function sanitizeFileName(name: string, maxLength = 120): string | null {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  let clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").replace(/\s+/g, " ").trim();
  clean = clean.replace(/^\.+/, ""); // no hidden files, no "." / ".."
  if (!clean || !hasVideoExtension(clean)) return null;
  if (clean.length > maxLength) {
    const dot = clean.lastIndexOf(".");
    const ext = clean.slice(dot);
    clean = clean.slice(0, maxLength - ext.length) + ext;
  }
  return clean;
}

/** Hostnames that resolve to the server itself or a private network (literal checks only). */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host === "metadata.google.internal") {
    return true;
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(":")) {
    return host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") ||
      host.startsWith("fe80") || host.startsWith("::ffff:");
  }
  return false;
}

/** File name the pipeline will save a URL download as (mirrors Python `filename_from_url`). */
export function fileNameFromUrl(url: URL): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    decoded = url.pathname; // malformed escape such as "%E0": keep it encoded
  }
  decoded = decoded.replace(/\\/g, "/");
  if (decoded.endsWith("/")) return "";
  const last = decoded.split("/").pop() ?? "";
  return last === "." || last === ".." ? "" : last;
}

export function validateVideoUrl(input: string, opts: { allowPrivate?: boolean } = {}): Result<URL> {
  const text = input.trim();
  if (!text) return err("Paste a video link.");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return err("That doesn't look like a link. It should start with https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return err("Only http:// and https:// links are supported.");
  if (url.username || url.password) return err("Links with embedded credentials are not allowed.");
  if (!opts.allowPrivate && isPrivateHost(url.hostname)) return err("Links to local or private network addresses are not allowed.");
  return ok(url);
}

type Bound = { min: number; max: number };

function optionalNumber(value: unknown, name: string, bound: Bound, integer = false): Result<number | undefined> {
  if (value === undefined || value === null || value === "") return ok(undefined);
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return err(`${name} must be a number.`);
  if (integer && !Number.isInteger(n)) return err(`${name} must be a whole number.`);
  if (n < bound.min || n > bound.max) return err(`${name} must be between ${bound.min} and ${bound.max}.`);
  return ok(n);
}

/** Validate user options; unknown keys are ignored, booleans default to on. */
export function validateJobOptions(input: unknown): Result<JobOptions> {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const stride = optionalNumber(raw.frameStride, "Frame stride", OPTION_LIMITS.frameStride, true);
  if (!stride.ok) return stride;
  const start = optionalNumber(raw.startS, "Start", OPTION_LIMITS.startS);
  if (!start.ok) return start;
  const max = optionalNumber(raw.maxSeconds, "Duration", OPTION_LIMITS.maxSeconds);
  if (!max.ok) return max;
  for (const key of ["hands", "imu"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") return err(`${key} must be true or false.`);
  }
  const options: JobOptions = {
    hands: (raw.hands as boolean | undefined) ?? DEFAULT_JOB_OPTIONS.hands,
    imu: (raw.imu as boolean | undefined) ?? DEFAULT_JOB_OPTIONS.imu,
  };
  if (stride.value !== undefined) options.frameStride = stride.value;
  if (start.value !== undefined) options.startS = start.value;
  if (max.value !== undefined) options.maxSeconds = max.value;
  return ok(options);
}

export interface ValidatedJobRequest {
  source: { kind: "upload"; uploadId: string } | { kind: "url"; url: URL };
  options: JobOptions;
}

/** Validate the body of `POST /api/jobs`. */
export function validateCreateJobRequest(body: unknown, opts: { allowPrivate?: boolean } = {}): Result<ValidatedJobRequest> {
  if (typeof body !== "object" || body === null) return err("Request body must be a JSON object.");
  const { source, options } = body as Partial<CreateJobRequest>;
  if (typeof source !== "object" || source === null) return err("`source` is required.");

  let validSource: ValidatedJobRequest["source"];
  if (source.kind === "upload") {
    if (!isId(source.uploadId)) return err("`source.uploadId` is not a valid upload id.");
    validSource = { kind: "upload", uploadId: source.uploadId };
  } else if (source.kind === "url") {
    if (typeof source.url !== "string") return err("`source.url` must be a string.");
    const url = validateVideoUrl(source.url, opts);
    if (!url.ok) return url;
    validSource = { kind: "url", url: url.value };
  } else {
    return err("`source.kind` must be \"upload\" or \"url\".");
  }

  const validOptions = validateJobOptions(options);
  if (!validOptions.ok) return validOptions;
  return ok({ source: validSource, options: validOptions.value });
}
