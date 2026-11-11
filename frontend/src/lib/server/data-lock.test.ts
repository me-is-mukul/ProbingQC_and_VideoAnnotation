import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireDataLock, LOCK_FILE, LOCK_STALE_MS, processAlive } from "./data-lock";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "probing-lock-"));
  dirs.push(dir);
  return dir;
}

describe("acquireDataLock", () => {
  it("lets the first server own the folder and keeps a second one out while the owner is alive", async () => {
    const dir = await tempDir();
    const first = await acquireDataLock(dir, { pid: 1001 });
    expect(first).toMatchObject({ owned: true, owner: 1001 });
    const second = await acquireDataLock(dir, { pid: 1002, isAlive: (p) => p === 1001 });
    expect(second).toMatchObject({ owned: false, owner: 1001 });
    await second.release(); // a non-owner's release leaves the lock alone
    expect(JSON.parse(await fs.readFile(path.join(dir, LOCK_FILE), "utf8")).pid).toBe(1001);
    await first.release();
    await expect(fs.stat(path.join(dir, LOCK_FILE))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("takes over a lock its owner stopped refreshing, even if the pid now belongs to another process", async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, LOCK_FILE), JSON.stringify({ pid: 2001 }));
    const later = Date.now() + LOCK_STALE_MS + 1000;
    const lock = await acquireDataLock(dir, { pid: 2002, now: () => later, isAlive: () => true });
    expect(lock).toMatchObject({ owned: true, owner: 2002 });
    await lock.release();
  });

  it("takes over a fresh lock at once when its server was killed (no process left)", async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, LOCK_FILE), JSON.stringify({ pid: 2101 }));
    const lock = await acquireDataLock(dir, { pid: 2102, isAlive: () => false });
    expect(lock.owned).toBe(true);
    await lock.release();
  });

  it("knows this process is alive", () => {
    expect(processAlive(process.pid)).toBe(true);
  });

  it("treats a missing data folder or an unreadable lock as free", async () => {
    const dir = path.join(await tempDir(), "fresh", "data");
    const lock = await acquireDataLock(dir, { pid: 3001 });
    expect(lock.owned).toBe(true);
    await lock.release();
    await fs.writeFile(path.join(dir, LOCK_FILE), "not json");
    const again = await acquireDataLock(dir, { pid: 3002 });
    expect(again.owned).toBe(true);
    await again.release();
  });
});
