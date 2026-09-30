"use client";

import { useMemo, useSyncExternalStore } from "react";
import { type ArtifactView, parseView, readStoredView } from "./artifact-state";

/** Nothing else writes these keys, so a snapshot only ever changes when this tab changes it. */
const subscribe = () => () => {};

/**
 * What this tab last chose for one chat's artifact column. Reading it through a store snapshot
 * is what makes it safe: the server and the first client render both see nothing, and the
 * stored choice arrives on the render that follows hydration rather than contradicting it.
 */
export function useRememberedView(sessionId: string | null): ArtifactView | null {
  const stored = useSyncExternalStore(
    subscribe,
    () => (sessionId === null ? null : readStoredView(sessionId)),
    () => null,
  );
  return useMemo(() => parseView(stored), [stored]);
}
