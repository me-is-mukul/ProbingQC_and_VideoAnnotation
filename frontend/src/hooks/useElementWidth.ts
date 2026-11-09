"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// useLayoutEffect on the client (measure before paint); a no-op-safe fallback on the server.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Width of an element. Measured synchronously before the first paint (so a chart never
 * draws at a guessed width and spills out of its card), then kept current with a
 * ResizeObserver.
 */
export function useElementWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measured = Math.floor(el.getBoundingClientRect().width);
    if (measured > 0) setWidth(measured); // layout measurement must happen before paint
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(0, Math.floor(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
