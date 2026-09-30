"use client";

import { useEffect } from "react";

/** A field the keystroke belongs to, so a shortcut never steals a letter the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable === true;
}

interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}

/** Ctrl/Cmd+`key` and no other modifier; with `skipTyping`, not while a field has the keystroke. */
export function isShortcut(event: ShortcutEvent, key: string, skipTyping: boolean): boolean {
  if (event.key.toLowerCase() !== key) return false;
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
  return !(skipTyping && isTypingTarget(event.target));
}

/** Run `handler` on Ctrl/Cmd+`key` anywhere in the app. */
export function useShortcut(key: string, handler: () => void, { skipTyping = false } = {}): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isShortcut(event, key, skipTyping)) return;
      event.preventDefault();
      handler();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, handler, skipTyping]);
}
