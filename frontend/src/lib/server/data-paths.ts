import "server-only";

import path from "node:path";

import { isId } from "@/lib/shared/validation";

/**
 * Every on-disk location the server uses, derived from DATA_DIR. Ids are validated
 * before they touch a path, so a crafted id can never escape the data folder.
 *
 *   <dataDir>/uploads/<uploadId>/meta.json, <file>
 *   <dataDir>/jobs/<jobId>/job.json, events.jsonl, results.json, outputs/, source/
 */
export class DataPaths {
  constructor(readonly dataDir: string) {}

  get uploadsRoot(): string {
    return path.join(this.dataDir, "uploads");
  }

  get jobsRoot(): string {
    return path.join(this.dataDir, "jobs");
  }

  uploadDir(uploadId: string): string {
    return path.join(this.uploadsRoot, assertId(uploadId));
  }

  jobDir(jobId: string): string {
    return path.join(this.jobsRoot, assertId(jobId));
  }

  jobFile(jobId: string, name: "job.json" | "events.jsonl" | "results.json"): string {
    return path.join(this.jobDir(jobId), name);
  }

  /** Resolve a relative path inside a job folder; throws if it would escape it. */
  insideJob(jobId: string, relative: string): string {
    const root = this.jobDir(jobId);
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Path escapes the job folder");
    return target;
  }
}

function assertId(id: string): string {
  if (!isId(id)) throw new Error(`Invalid id: ${JSON.stringify(id).slice(0, 60)}`);
  return id;
}
