import "server-only";

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** How often the owning server refreshes its lock. */
export const LOCK_HEARTBEAT_MS = 10_000;
/** A lock not refreshed for this long belongs to a server that is gone (crashed, killed). */
export const LOCK_STALE_MS = 3 * LOCK_HEARTBEAT_MS;
export const LOCK_FILE = "server.lock";

export interface DataLock {
  /** True when this process owns the data folder and may treat its unfinished jobs as its own. */
  readonly owned: boolean;
  /** Process id of the server that holds the lock when this one does not. */
  readonly owner: number | null;
  release(): Promise<void>;
}

interface LockOptions {
  pid?: number;
  now?: () => number;
  heartbeatMs?: number;
  isAlive?: (pid: number) => boolean;
}

/** Whether a process with this id exists (signal 0 only checks; EPERM means it exists). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLock(file: string): Promise<{ pid: number; writtenAt: number } | null> {
  try {
    const [text, stat] = await Promise.all([fsp.readFile(file, "utf8"), fsp.stat(file)]);
    const pid = Number((JSON.parse(text) as { pid?: unknown }).pid);
    return Number.isSafeInteger(pid) ? { pid, writtenAt: stat.mtimeMs } : null;
  } catch {
    return null; // missing or unreadable: nobody holds it
  }
}

/**
 * One server per data folder. On start-up every server marks the jobs it finds queued or
 * running as interrupted, which is only right if no other live server is running them.
 * The owner rewrites `<dataDir>/server.lock` every LOCK_HEARTBEAT_MS. A second server
 * leaves the lock alone only while it is both fresh and held by a running process, so a
 * killed server's lock is taken over at once, and a reused pid stops counting once the
 * heartbeat goes stale.
 */
export async function acquireDataLock(dataDir: string, options: LockOptions = {}): Promise<DataLock> {
  const pid = options.pid ?? process.pid;
  const file = path.join(dataDir, LOCK_FILE);
  await fsp.mkdir(dataDir, { recursive: true });

  const current = await readLock(file);
  const now = (options.now ?? Date.now)();
  const isAlive = options.isAlive ?? processAlive;
  if (current && current.pid !== pid && now - current.writtenAt < LOCK_STALE_MS && isAlive(current.pid)) {
    return { owned: false, owner: current.pid, release: async () => {} };
  }

  const body = JSON.stringify({ pid, startedAt: new Date().toISOString() });
  await fsp.writeFile(file, body);
  const holds = () => {
    try {
      return Number((JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: unknown }).pid) === pid;
    } catch {
      return false;
    }
  };
  const timer = setInterval(() => {
    // Another server may have taken over while this one was suspended; never overwrite it.
    if (holds()) fs.writeFile(file, body, () => {});
    else clearInterval(timer);
  }, options.heartbeatMs ?? LOCK_HEARTBEAT_MS);
  timer.unref();
  const onExit = () => {
    if (holds()) fs.rmSync(file, { force: true });
  };
  process.once("exit", onExit);

  return {
    owned: true,
    owner: pid,
    release: async () => {
      clearInterval(timer);
      process.removeListener("exit", onExit);
      if (holds()) await fsp.rm(file, { force: true });
    },
  };
}
