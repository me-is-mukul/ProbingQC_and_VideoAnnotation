import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { acceptsGzip, compressedResponse } from "./compress";

const req = (encoding?: string) => new Request("http://x/api", { headers: encoding === undefined ? {} : { "accept-encoding": encoding } });

describe("compression", () => {
  it("reads Accept-Encoding, including q-values", () => {
    expect(acceptsGzip(req("gzip, deflate, br"))).toBe(true);
    expect(acceptsGzip(req("br;q=1.0, gzip;q=0.8"))).toBe(true);
    expect(acceptsGzip(req("*"))).toBe(true);
    expect(acceptsGzip(req("gzip;q=0"))).toBe(false);
    expect(acceptsGzip(req("br"))).toBe(false);
    expect(acceptsGzip(req())).toBe(false);
  });

  it("gzips string and stream bodies when accepted, and always varies on Accept-Encoding", async () => {
    const text = "timestamp_s,acc_x\n".repeat(200);
    const gz = compressedResponse(req("gzip"), text, { headers: { "Content-Type": "text/csv", "Content-Length": "9" } });
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    expect(gz.headers.get("content-length")).toBeNull();
    expect(gz.headers.get("vary")).toBe("Accept-Encoding");
    const bytes = Buffer.from(await gz.arrayBuffer());
    expect(bytes.length).toBeLessThan(text.length / 10);
    expect(gunzipSync(bytes).toString("utf8")).toBe(text);

    const plain = compressedResponse(req("identity"), new Blob([text]).stream(), { headers: { "Content-Type": "text/csv" } });
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.text()).toBe(text);
  });
});
