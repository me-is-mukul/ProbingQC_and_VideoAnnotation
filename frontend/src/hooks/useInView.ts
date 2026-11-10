"use client";

import { useEffect, useState } from "react";

/** True while any part of the element is in the viewport (IntersectionObserver). */
export function useInView(ref: React.RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}
