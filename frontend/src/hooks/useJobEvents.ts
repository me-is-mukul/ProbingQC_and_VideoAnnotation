"use client";

import { useEffect, useRef, useState } from "react";

import { endpoints } from "@/lib/client/api";
import { isTerminalEvent, toPipelineEvent } from "@/lib/shared/events";
import type { StoredEvent } from "@/lib/shared/types";

export type StreamState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

/**
 * Subscribe to a job's Server-Sent Events. The browser reconnects automatically and
 * sends Last-Event-ID, so the server resumes exactly where the stream broke. The stream
 * is closed after the terminal `job` event (otherwise EventSource would reconnect forever).
 */
export function useJobEvents(jobId: string | null, onEvent: (event: StoredEvent) => void): StreamState {
  // State is tagged with the job it belongs to; a new job reads as "connecting" until its
  // stream reports in, without a synchronous setState inside the effect.
  const [status, setStatus] = useState<{ jobId: string | null; state: StreamState }>({ jobId: null, state: "idle" });
  const handler = useRef(onEvent);

  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!jobId) return;
    const source = new EventSource(endpoints.events(jobId));
    let done = false;
    const setState = (state: StreamState) => setStatus({ jobId, state });

    source.onopen = () => setState("open");
    source.onmessage = (message: MessageEvent<string>) => {
      let raw: unknown;
      try {
        raw = JSON.parse(message.data);
      } catch {
        return;
      }
      const event = toPipelineEvent(raw);
      if (!event || typeof event.seq !== "number") return;
      handler.current(event as StoredEvent);
      if (isTerminalEvent(event)) {
        done = true;
        source.close();
        setState("closed");
      }
    };
    source.onerror = () => {
      if (done) return;
      setState(source.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
    };

    return () => {
      done = true;
      source.close();
    };
  }, [jobId]);

  if (!jobId) return "idle";
  return status.jobId === jobId ? status.state : "connecting";
}
