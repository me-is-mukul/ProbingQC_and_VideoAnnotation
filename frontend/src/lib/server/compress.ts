import "server-only";

/**
 * gzip for API responses. Next.js compresses pages but not route-handler responses, and
 * the data routes (results JSON, frame table, IMU CSV) are text that shrinks 3-5×, which
 * is egress the platform bills for. Compression is streamed, so memory stays flat.
 */

/** True when the client accepts gzip (and has not set gzip;q=0). */
export function acceptsGzip(request: Request): boolean {
  const header = request.headers.get("accept-encoding") ?? "";
  return header.split(",").some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (name !== "gzip" && name !== "*") return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}

/** A response that is gzip-encoded when the client accepts it. Always varies on Accept-Encoding. */
export function compressedResponse(
  request: Request,
  body: ReadableStream<Uint8Array> | string,
  init: { status?: number; headers: Record<string, string> },
): Response {
  const headers = new Headers(init.headers);
  headers.append("Vary", "Accept-Encoding");
  if (!acceptsGzip(request)) return new Response(body, { status: init.status, headers });
  const stream = typeof body === "string" ? new Blob([body]).stream() : body;
  headers.set("Content-Encoding", "gzip");
  headers.delete("Content-Length");
  // DOM typings declare BufferSource chunks; every chunk here is a Uint8Array.
  const gzip = new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>;
  return new Response(stream.pipeThrough(gzip), { status: init.status, headers });
}
