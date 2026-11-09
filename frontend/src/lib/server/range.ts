/**
 * HTTP Range header parsing for video streaming (single range only, RFC 9110 §14).
 * Pure: no server-only import, so it is trivially unit-testable.
 */

export interface ByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

/**
 * - `null`: no (or an ignorable) Range header -> send the whole file with 200.
 * - `"unsatisfiable"`: syntactically valid but outside the file -> 416.
 * - a range -> 206 with `Content-Range`.
 * Multi-range requests are answered with the first range only.
 */
export function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)(?:,.*)?$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart = "", rawEnd = ""] = match;
  if (rawStart === "" && rawEnd === "") return null;
  if (size <= 0) return "unsatisfiable";

  if (rawStart === "") {
    // suffix range: last N bytes
    const length = Number(rawEnd);
    if (length === 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end };
}

export function contentRange(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}
