import "server-only";

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { formatBytes } from "@/lib/shared/format";
import type { UploadInfo } from "@/lib/shared/types";
import { isId, sanitizeFileName } from "@/lib/shared/validation";

import type { DataPaths } from "../data-paths";
import { ApiError, badRequest } from "../http";

export interface StoredUpload extends UploadInfo {
  /** Absolute path of the stored video. Server-side only; never sent to the browser. */
  path: string;
  createdAt: string;
}

/**
 * Stores uploaded videos. The request body is streamed straight to disk (constant memory,
 * multi-GB files fine) through a byte counter that aborts past `maxBytes`. A partial file
 * never becomes visible: data lands in `<name>.part` and is renamed when complete.
 */
export class UploadStore {
  constructor(
    private readonly paths: DataPaths,
    private readonly maxBytes: number,
    private readonly newId: () => string = randomUUID,
  ) {}

  async save(body: ReadableStream<Uint8Array> | null, rawName: string, declaredSize?: number): Promise<StoredUpload> {
    const fileName = sanitizeFileName(rawName);
    if (!fileName) throw badRequest("Only .mp4 and .mov videos can be uploaded.");
    if (!body) throw badRequest("The upload is empty.");
    if (declaredSize !== undefined && declaredSize > this.maxBytes) throw tooLarge(this.maxBytes);

    const uploadId = this.newId();
    const dir = this.paths.uploadDir(uploadId);
    const target = path.join(dir, fileName);
    const partial = `${target}.part`;
    await fs.mkdir(dir, { recursive: true });

    let received = 0;
    const limit = this.maxBytes;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        callback(received > limit ? tooLarge(limit) : null, chunk);
      },
    });

    try {
      await pipeline(Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>), counter, createWriteStream(partial));
      if (received === 0) throw badRequest("The upload is empty.");
      await fs.rename(partial, target);
    } catch (error) {
      await fs.rm(dir, { recursive: true, force: true });
      if (error instanceof ApiError) throw error;
      throw new ApiError(499, "upload_aborted", "The upload was interrupted before it finished.");
    }

    const stored: StoredUpload = {
      uploadId, fileName, sizeBytes: received, path: target, createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(stored, null, 2), "utf8");
    return stored;
  }

  async get(uploadId: string): Promise<StoredUpload | null> {
    if (!isId(uploadId)) return null;
    try {
      const meta = JSON.parse(await fs.readFile(path.join(this.paths.uploadDir(uploadId), "meta.json"), "utf8")) as StoredUpload;
      await fs.access(meta.path);
      return meta;
    } catch {
      return null;
    }
  }
}

function tooLarge(limit: number): ApiError {
  return new ApiError(413, "too_large", `The file is larger than the ${formatBytes(limit)} limit.`);
}
