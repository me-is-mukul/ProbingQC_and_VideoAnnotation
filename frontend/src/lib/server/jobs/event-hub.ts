import type { StoredEvent } from "@/lib/shared/types";

type Listener = (event: StoredEvent) => void;

/**
 * In-process publish/subscribe for live job events (one Node process).
 * Persistence and replay are the JobStore's job; the hub only fans out new events.
 * For multi-instance deployments replace it with Pub/Sub or Redis behind the same API.
 */
export class EventHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(jobId: string, listener: Listener): () => void {
    let set = this.listeners.get(jobId);
    if (!set) {
      set = new Set();
      this.listeners.set(jobId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(jobId);
    };
  }

  publish(jobId: string, event: StoredEvent): void {
    for (const listener of [...(this.listeners.get(jobId) ?? [])]) {
      try {
        listener(event);
      } catch (error) {
        console.error("[event-hub] listener failed", error);
      }
    }
  }

  listenerCount(jobId: string): number {
    return this.listeners.get(jobId)?.size ?? 0;
  }
}
