"use client";

import { useEffect } from "react";

const message = "You have unsaved changes. Leave this page and discard them?";

/** Mounted components that currently hold unsaved edits. */
let holders = 0;

/** Whether a click on `anchor` would take the browser to another page of this app. */
function leavesPage(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return false;
  const url = new URL(anchor.href, location.href);
  return url.origin === location.origin && (url.pathname !== location.pathname || url.search !== location.search);
}

/** True when nothing is unsaved or the user agrees to discard it. Call it before `router.push`. */
export function confirmLeave(): boolean {
  return holders === 0 || window.confirm(message);
}

const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

// Capture phase runs before React's handlers, so `next/link` sees the prevented default.
const onClick = (event: MouseEvent) => {
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (anchor instanceof HTMLAnchorElement && leavesPage(event, anchor) && !confirmLeave()) event.preventDefault();
};

/** Counts one holder of unsaved edits until the returned release runs; the listeners stay while any is held. */
export function holdUnsavedChanges(): () => void {
  if (holders++ === 0) {
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
  }
  return () => {
    if (--holders > 0) return;
    window.removeEventListener("beforeunload", onBeforeUnload);
    document.removeEventListener("click", onClick, true);
  };
}

/**
 * Asks before leaving while `dirty`: closing or reloading the tab (`beforeunload`), clicking a
 * same-origin link (`next/link` skips navigation once the click is default-prevented), and code
 * that calls `confirmLeave` first, such as New chat. App Router has no navigation events, so
 * browser Back/Forward is not caught.
 */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => (dirty ? holdUnsavedChanges() : undefined), [dirty]);
}
