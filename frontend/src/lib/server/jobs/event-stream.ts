import "server-only";

import { isTerminalEvent, isTerminalStatus } from "@/lib/shared/events";
import { encodeSSE, encodeSSEComment } from "@/lib/shared/sse";
import type { Job, StoredEvent } from "@/lib/shared/types";

/** The subset of JobService the stream needs (keeps it testable with a fake). */
export interface JobEventSource {
  get(id: string): Promise<Job | null>;
  events(id: string, afterSeq: number): Promise<StoredEvent[]>;
  subscribe(id: string, listener: (event: StoredEvent) => void): () => void;
}

export interface EventStreamOptions {
  heartbeatMs?: number;
  /** Browser reconnect delay hint. */
  retryMs?: number;
}

/**
 * An SSE byte stream for one job: replays stored events after `afterSeq`, then forwards
 * live ones, and closes after the terminal `job` event. Live events that arrive during the
 * replay are buffered and de-duplicated by `seq`, so nothing is lost or sent twice.
 * `afterSeq` comes from the browser's `Last-Event-ID`, so reconnects resume exactly.
 */
export function createJobEventStream(
  source: JobEventSource,
  jobId: string,
  afterSeq: number,
  signal: AbortSignal,
  { heartbeatMs = 15_000, retryMs = 2_000 }: EventStreamOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastSent = afterSeq;
      let closed = false;
      let replaying = true;
      const buffered: StoredEvent[] = [];

      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed by the consumer
        }
      };
      const send = (event: StoredEvent) => {
        if (closed || event.seq <= lastSent) return;
        lastSent = event.seq;
        controller.enqueue(encoder.encode(encodeSSE({ id: event.seq, data: JSON.stringify(event) })));
        if (isTerminalEvent(event)) close();
      };

      const unsubscribe = source.subscribe(jobId, (event) => (replaying ? buffered.push(event) : send(event)));
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(encodeSSEComment()));
      }, heartbeatMs);
      const onAbort = () => close();
      signal.addEventListener("abort", onAbort);
      cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
        signal.removeEventListener("abort", onAbort);
      };
      if (signal.aborted) return close();

      controller.enqueue(encoder.encode(`retry: ${retryMs}\n\n`));
      try {
        for (const event of await source.events(jobId, afterSeq)) send(event);
        replaying = false;
        for (const event of buffered.splice(0)) send(event);
        // A job that already finished (and whose terminal event was before afterSeq) ends here.
        const job = await source.get(jobId);
        if (!job || isTerminalStatus(job.status)) {
          const tail = await source.events(jobId, lastSent);
          tail.forEach(send);
          close();
        }
      } catch (error) {
        console.error("[sse] stream failed", error);
        close();
      }
    },
    cancel() {
      cleanup();
    },
  });
}

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no", // disable proxy buffering (nginx, some load balancers)
};
