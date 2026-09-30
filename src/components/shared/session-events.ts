"use client";

import { useEffect } from "react";

const SESSIONS_CHANGED = "ofa:sessions-changed";
const SCHEDULED_CHANGED = "ofa:scheduled-changed";

/** Tell the sidebar that the session list (or a title) changed. */
export function notifySessionsChanged(): void {
  window.dispatchEvent(new Event(SESSIONS_CHANGED));
}

export function useSessionsChanged(onChange: () => void): void {
  useEffect(() => {
    window.addEventListener(SESSIONS_CHANGED, onChange);
    return () => window.removeEventListener(SESSIONS_CHANGED, onChange);
  }, [onChange]);
}

/** Tell scheduled inboxes and the sidebar unread badge that task/run state changed. */
export function notifyScheduledChanged(): void {
  window.dispatchEvent(new Event(SCHEDULED_CHANGED));
}

export function useScheduledChanged(onChange: () => void): void {
  useEffect(() => {
    window.addEventListener(SCHEDULED_CHANGED, onChange);
    return () => window.removeEventListener(SCHEDULED_CHANGED, onChange);
  }, [onChange]);
}
