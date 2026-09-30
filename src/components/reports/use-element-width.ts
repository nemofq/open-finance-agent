"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * An element's own width in px, rAF-throttled so a resize storm costs one measure per frame.
 * `null` until the first measurement, which lets a caller hold back anything that would
 * otherwise render at the wrong size (and disagree with the server's markup).
 */
export function useElementWidth<T extends HTMLElement>(): { ref: RefObject<T | null>; width: number | null } {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;

    let frame: number | null = null;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();

    const observer = new ResizeObserver(() => {
      frame ??= requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  return { ref, width };
}
