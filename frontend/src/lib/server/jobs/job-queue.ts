/**
 * A FIFO queue that runs at most `concurrency` tasks at once. Video QC saturates the CPU,
 * so running jobs in parallel on one instance only makes all of them slower (and costlier).
 */
export class JobQueue {
  private readonly pending: Array<{ id: string; task: () => Promise<void> }> = [];
  private readonly active = new Set<string>();

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be >= 1");
  }

  enqueue(id: string, task: () => Promise<void>): void {
    this.pending.push({ id, task });
    this.drain();
  }

  /** Remove a job that has not started yet. Returns false if it is running or unknown. */
  remove(id: string): boolean {
    const index = this.pending.findIndex((p) => p.id === id);
    if (index === -1) return false;
    this.pending.splice(index, 1);
    return true;
  }

  /** 1-based place in line, or 0 when running / not queued. */
  position(id: string): number {
    return this.pending.findIndex((p) => p.id === id) + 1;
  }

  get runningCount(): number {
    return this.active.size;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  private drain(): void {
    while (this.active.size < this.concurrency && this.pending.length > 0) {
      const next = this.pending.shift()!;
      this.active.add(next.id);
      void next.task()
        .catch((error) => console.error(`[job-queue] task ${next.id} failed`, error))
        .finally(() => {
          this.active.delete(next.id);
          this.drain();
        });
    }
  }
}
