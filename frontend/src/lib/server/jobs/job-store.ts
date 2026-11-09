import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import type { Job, PipelineEvent, StoredEvent } from "@/lib/shared/types";

import type { DataPaths } from "../data-paths";

/**
 * Persistence for jobs and their event logs. The interface is the seam for swapping
 * the file implementation for Firestore / Cloud SQL when running more than one instance.
 */
export interface JobStore {
  create(job: Job): Promise<void>;
  get(id: string): Promise<Job | null>;
  update(id: string, patch: Partial<Omit<Job, "id">>): Promise<Job>;
  list(): Promise<Job[]>;
  /** Append an event and assign it the next sequence number (1, 2, 3, ...). */
  appendEvent(id: string, event: PipelineEvent): Promise<StoredEvent>;
  /** Events with `seq > afterSeq`, in order. */
  readEvents(id: string, afterSeq?: number): Promise<StoredEvent[]>;
}

/**
 * File-backed store: `job.json` (atomically replaced) and `events.jsonl` (append-only).
 * Writes per job are serialised through a promise chain so sequence numbers and file
 * contents can never interleave.
 */
export class FileJobStore implements JobStore {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly seqs = new Map<string, number>();

  constructor(private readonly paths: DataPaths) {}

  async create(job: Job): Promise<void> {
    await fs.mkdir(this.paths.jobDir(job.id), { recursive: true });
    await this.serial(job.id, () => this.writeJob(job));
  }

  async get(id: string): Promise<Job | null> {
    try {
      return JSON.parse(await fs.readFile(this.paths.jobFile(id, "job.json"), "utf8")) as Job;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async update(id: string, patch: Partial<Omit<Job, "id">>): Promise<Job> {
    return this.serial(id, async () => {
      const current = await this.get(id);
      if (!current) throw new Error(`Job ${id} not found`);
      const next = { ...current, ...patch, id };
      await this.writeJob(next);
      return next;
    });
  }

  async list(): Promise<Job[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.paths.jobsRoot);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const jobs = await Promise.all(entries.map((id) => this.get(id).catch(() => null)));
    return jobs.filter((j): j is Job => j !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async appendEvent(id: string, event: PipelineEvent): Promise<StoredEvent> {
    return this.serial(id, async () => {
      const seq = (await this.lastSeq(id)) + 1;
      const stored = { ...event, seq } as StoredEvent;
      await fs.appendFile(this.paths.jobFile(id, "events.jsonl"), `${JSON.stringify(stored)}\n`, "utf8");
      this.seqs.set(id, seq);
      return stored;
    });
  }

  async readEvents(id: string, afterSeq = 0): Promise<StoredEvent[]> {
    let text: string;
    try {
      text = await fs.readFile(this.paths.jobFile(id, "events.jsonl"), "utf8");
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const events: StoredEvent[] = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const event = JSON.parse(line) as StoredEvent;
        if (event.seq > afterSeq) events.push(event);
      } catch {
        // a torn final line (crash mid-write) is skipped, never fatal
      }
    }
    return events;
  }

  private async lastSeq(id: string): Promise<number> {
    const cached = this.seqs.get(id);
    if (cached !== undefined) return cached;
    const events = await this.readEvents(id);
    const last = events.at(-1)?.seq ?? 0;
    this.seqs.set(id, last);
    return last;
  }

  private async writeJob(job: Job): Promise<void> {
    const file = this.paths.jobFile(job.id, "job.json");
    const tmp = path.join(path.dirname(file), `.job.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(job, null, 2), "utf8");
    await fs.rename(tmp, file);
  }

  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.locks.set(id, next.catch(() => undefined));
    return next;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
