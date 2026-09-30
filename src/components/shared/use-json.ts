"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/utils";
import { getJson } from "./http-client";

export interface Loaded<T> {
  /** The latest answer; `null` until the first one arrives. A failed read keeps the last one. */
  data: T | null;
  /** Why the latest read failed; cleared by the next one that succeeds. */
  error: string | null;
  /** True until the first read settles, and again while `reload` runs. */
  loading: boolean;
  /**
   * Read now, outside the schedule; for a caller that has just changed what the source returns.
   * `from` stands in for the loader this once, such as the same data with fresh quotes.
   */
  reload: (from?: () => Promise<T>) => Promise<void>;
}

interface LoadOptions {
  /** Read again this often while the tab is visible, and at once when it becomes visible again. */
  intervalMs?: number;
  /** A change of this (a navigation, say) reads again. */
  refreshKey?: unknown;
}

interface LoadState<T> {
  /** The key `data` and `error` belong to. */
  key: string | null;
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Read `load(key)` now, then on `options`' schedule. An answer that arrives after a newer read
 * started, or after the component has gone, is dropped, so a slow read never overwrites a fresher
 * one; and no scheduled read starts while a `reload` runs, so a poll cannot drop what the caller
 * asked for. A new `key` starts again from nothing; a `null` one reads nothing and keeps what is shown.
 */
export function useLoader<T>(
  key: string | null,
  load: (key: string) => Promise<T>,
  { intervalMs, refreshKey }: LoadOptions = {},
): Loaded<T> {
  const [state, setState] = useState<LoadState<T>>({ key, data: null, error: null, loading: key !== null });
  const latest = useRef(0);
  /** Reloads in flight; the schedule waits them out. */
  const reloading = useRef(0);
  // Read through a ref, so a caller may pass a fresh function on every render.
  const source = useRef(load);
  useEffect(() => {
    source.current = load;
  });

  const read = useCallback(
    async (from?: () => Promise<T>) => {
      if (key === null) return;
      const ticket = ++latest.current;
      try {
        const data = await (from ?? (() => source.current(key)))();
        if (ticket === latest.current) setState({ key, data, error: null, loading: false });
      } catch (err) {
        if (ticket !== latest.current) return;
        setState((current) => ({
          key,
          data: current.key === key ? current.data : null,
          error: errorMessage(err),
          loading: false,
        }));
      }
    },
    [key],
  );

  const reload = useCallback(
    async (from?: () => Promise<T>) => {
      if (key === null) return;
      setState((current) => ({ ...current, loading: true }));
      reloading.current += 1;
      try {
        await read(from);
      } finally {
        reloading.current -= 1;
      }
    },
    [key, read],
  );

  useEffect(() => {
    if (key === null) return;
    void read();
    const poll = () => {
      if (document.visibilityState === "visible" && reloading.current === 0) void read();
    };
    const timer = intervalMs === undefined ? undefined : setInterval(poll, intervalMs);
    if (timer !== undefined) document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      // Whatever is still in flight answers a request this effect no longer stands behind.
      latest.current += 1;
    };
  }, [key, read, intervalMs, refreshKey]);

  const shown = key === null || state.key === key ? state : { data: null, error: null, loading: true };
  return { data: shown.data, error: shown.error, loading: shown.loading, reload };
}

/** `useLoader` over a GET of `url`; a `null` URL reads nothing. */
export function useJson<T>(url: string | null, options?: LoadOptions): Loaded<T> {
  return useLoader(url, getJson<T>, options);
}
