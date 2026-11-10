"use client";

import { useEffect, useState } from "react";

import { fetchFramesCsv } from "@/lib/client/api";

import { parseFramesCsv, type FramesTable } from "./frames-table";

export type FramesTableState =
  | { status: "loading" }
  | { status: "ready"; table: FramesTable }
  | { status: "error"; message: string };

/**
 * Loads the per-frame table once per job. It is the one large download of the results
 * page (about 110 bytes per analysed frame before compression), cached immutable by the
 * browser, and needed only for probing.
 */
export function useFramesTable(jobId: string | null): FramesTableState {
  const [state, setState] = useState<{ jobId: string | null; value: FramesTableState }>({ jobId: null, value: { status: "loading" } });

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    fetchFramesCsv(jobId, controller.signal)
      .then((text) => {
        const parsed = parseFramesCsv(text);
        setState({ jobId, value: parsed.ok ? { status: "ready", table: parsed.value } : { status: "error", message: parsed.error } });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name === "AbortError") return;
        setState({ jobId, value: { status: "error", message: error instanceof Error ? error.message : "Could not load the frame table." } });
      });
    return () => controller.abort();
  }, [jobId]);

  if (!jobId) return { status: "error", message: "No job to load frames for." };
  return state.jobId === jobId ? state.value : { status: "loading" };
}
