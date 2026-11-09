import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { streamOf, tempDir } from "../../../../tests/helpers/server";
import { DataPaths } from "../data-paths";
import { UploadStore } from "./upload-store";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function store(maxBytes = 1024) {
  const dir = await tempDir();
  dirs.push(dir);
  return { dir, uploads: new UploadStore(new DataPaths(dir), maxBytes, () => "66666666-6666-4666-8666-666666666666") };
}

describe("UploadStore", () => {
  it("streams the body to disk under a sanitised name and reads it back", async () => {
    const { uploads } = await store();
    const saved = await uploads.save(streamOf("abc", new Uint8Array([1, 2, 3])), "../../My Clip.MP4");
    expect(saved).toMatchObject({ fileName: "My Clip.MP4", sizeBytes: 6 });
    expect(path.basename(path.dirname(saved.path))).toBe(saved.uploadId);
    expect((await fs.readFile(saved.path)).length).toBe(6);
    expect(await uploads.get(saved.uploadId)).toMatchObject({ fileName: "My Clip.MP4" });
  });

  it("rejects non-video names before reading the body", async () => {
    const { uploads } = await store();
    await expect(uploads.save(streamOf("x"), "notes.txt")).rejects.toMatchObject({ status: 400 });
  });

  it("rejects empty bodies and leaves nothing behind", async () => {
    const { uploads, dir } = await store();
    await expect(uploads.save(streamOf(), "a.mp4")).rejects.toMatchObject({ status: 400 });
    await expect(uploads.save(null, "a.mp4")).rejects.toMatchObject({ status: 400 });
    expect(await fs.readdir(path.join(dir, "uploads")).catch(() => [])).toEqual([]);
  });

  it("enforces the size limit from the header and while streaming", async () => {
    const { uploads, dir } = await store(8);
    await expect(uploads.save(streamOf("x"), "a.mp4", 9)).rejects.toMatchObject({ status: 413 });
    await expect(uploads.save(streamOf("12345", "67890"), "a.mp4")).rejects.toMatchObject({ status: 413 });
    expect(await fs.readdir(path.join(dir, "uploads"))).toEqual([]); // partial file removed
  });

  it("maps a client abort to 499 and cleans up", async () => {
    const { uploads, dir } = await store();
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.error(new Error("socket hang up"));
      },
    });
    await expect(uploads.save(broken, "a.mp4")).rejects.toMatchObject({ status: 499 });
    expect(await fs.readdir(path.join(dir, "uploads"))).toEqual([]);
  });

  it("returns null for unknown or malformed ids", async () => {
    const { uploads } = await store();
    expect(await uploads.get("77777777-7777-4777-8777-777777777777")).toBeNull();
    expect(await uploads.get("../etc")).toBeNull();
  });
});
