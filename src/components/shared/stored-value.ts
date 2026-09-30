"use client";

import { useSyncExternalStore } from "react";

/**
 * One small preference kept in `localStorage`, shaped for `useSyncExternalStore`. Storage may be
 * missing or refuse a write (a private window, a full quota); then the preference simply falls back
 * and lasts only as long as nothing re-reads it.
 */
export interface StoredValue<T> {
  subscribe: (listener: () => void) => () => void;
  /** The browser's value: what is stored, or the fallback when nothing readable is. */
  getSnapshot: () => T;
  /** What the server renders, before storage can be read; hydration then corrects it. */
  getServerSnapshot: () => T;
  set: (value: T) => void;
}

export interface StoredValueOptions<T> {
  /** How the value is written; `String(value)` by default. */
  serialize?: (value: T) => string;
  /** The server's render when it should differ from the fallback, such as keeping a hint hidden. */
  serverValue?: T;
}

/**
 * A value under `key`. `parse` reads the stored string, or answers `undefined` for anything it does
 * not recognise, which reads as `fallback`. Keys are the ones users already have saved values under,
 * so they must not change.
 */
export function createStoredValue<T>(
  key: string,
  parse: (raw: string) => T | undefined,
  fallback: T,
  { serialize = String, serverValue = fallback }: StoredValueOptions<T> = {},
): StoredValue<T> {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : (parse(raw) ?? fallback);
      } catch {
        return fallback;
      }
    },
    getServerSnapshot: () => serverValue,
    set(value) {
      try {
        localStorage.setItem(key, serialize(value));
      } catch {
        // Kept for this render only; the next read falls back.
      }
      for (const listener of listeners) listener();
    },
  };
}

/** Read a stored value in a component, re-rendering when it is set anywhere on the page. */
export function useStoredValue<T>(store: StoredValue<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
