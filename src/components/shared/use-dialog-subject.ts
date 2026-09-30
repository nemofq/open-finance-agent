"use client";

import { useCallback, useState } from "react";

interface DialogSubject<T> {
  open: boolean;
  /** Changes on every `show`: pass it as the dialog's `key` so it remounts with a fresh draft. */
  key: number;
  /** What the dialog was last shown for; kept while it closes, so its content does not jump. */
  subject: T | undefined;
  show: (subject?: T) => void;
  onOpenChange: (open: boolean) => void;
}

/** Open state for a dialog or inline editor that seeds its draft at mount, such as an Add or Edit form. */
export function useDialogSubject<T = never>(): DialogSubject<T> {
  const [state, setState] = useState<{ open: boolean; key: number; subject?: T }>({ open: false, key: 0 });
  const show = useCallback((subject?: T) => setState((current) => ({ open: true, key: current.key + 1, subject })), []);
  const onOpenChange = useCallback((open: boolean) => setState((current) => ({ ...current, open })), []);
  return { open: state.open, key: state.key, subject: state.subject, show, onOpenChange };
}
