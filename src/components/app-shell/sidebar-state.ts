"use client";

import { createStoredValue, useStoredValue } from "@/components/shared/stored-value";

/**
 * Collapse is shared between the shell (which animates the column) and the sidebar (which swaps
 * its layout), so it lives outside React. The server renders the expanded column: the persisted
 * value is only readable once localStorage is.
 */
export const sidebarStore = createStoredValue("open-finance.sidebar.collapsed", (raw) => raw === "true", false);

/**
 * Whether the user has toggled the column in this page's life. Restoring a persisted state — and
 * the re-render hydration does to correct it — must paint at its final width; only a toggle slides.
 */
let toggled = false;

export function hasSidebarToggled(): boolean {
  return toggled;
}

export function useSidebarCollapsed(): boolean {
  return useStoredValue(sidebarStore);
}

export function toggleSidebar(): void {
  toggled = true;
  sidebarStore.set(!sidebarStore.getSnapshot());
}
