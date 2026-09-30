"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/components/shared/http-client";
import type { SymbolHit } from "@/lib/tickers/types";

/** `$` plus up to five letters, immediately before the caret and not inside a word. */
const FRAGMENT = /(?:^|[^A-Za-z0-9_$])\$([A-Za-z]{0,5})$/;

const DEBOUNCE_MS = 150;

export interface TickerFragment {
  /** Index of the `$`, so the whole fragment can be replaced on select. */
  start: number;
  query: string;
}

export function tickerFragment(value: string, caret: number): TickerFragment | null {
  const match = FRAGMENT.exec(value.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1].length - 1, query: match[1] };
}

export interface TickerSuggestions {
  items: SymbolHit[];
  loading: boolean;
}

/** Completed searches, shared across composer mounts; failures are not cached. */
const results = new Map<string, SymbolHit[]>();

/** Debounced `/api/tickers/search`; `null` disables the search entirely. */
export function useTickerSuggestions(query: string | null): TickerSuggestions {
  const key = query?.trim().toUpperCase() ?? "";
  const [loaded, setLoaded] = useState<{ key: string; items: SymbolHit[] } | null>(null);

  useEffect(() => {
    if (!key || results.has(key)) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const hits = await requestJson<SymbolHit[]>(`/api/tickers/search?q=${encodeURIComponent(key)}`, {
            signal: controller.signal,
            cache: "no-store",
          });
          results.set(key, hits);
          setLoaded({ key, items: hits });
        } catch {
          if (!controller.signal.aborted) setLoaded({ key, items: [] });
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key]);

  const cached = key ? results.get(key) : undefined;
  const settled = cached ?? (loaded?.key === key ? loaded.items : undefined);
  return { items: settled ?? [], loading: key !== "" && settled === undefined };
}
