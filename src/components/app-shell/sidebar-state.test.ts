import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Run the hooks outside React: only the store is under test.
vi.mock("react", () => ({ useSyncExternalStore: vi.fn() }));

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
});

const { sidebarStore, toggleSidebar } = await import("./sidebar-state");

const unsubscribers: (() => void)[] = [];
beforeEach(() => storage.clear());
afterEach(() => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
});

describe("sidebarStore", () => {
  it("starts expanded, on the server and with nothing stored", () => {
    expect(sidebarStore.getServerSnapshot()).toBe(false);
    expect(sidebarStore.getSnapshot()).toBe(false);
  });

  it("persists the collapsed column under its old key and tells its subscribers", () => {
    const listener = vi.fn();
    unsubscribers.push(sidebarStore.subscribe(listener));
    toggleSidebar();
    expect(sidebarStore.getSnapshot()).toBe(true);
    expect(storage.get("open-finance.sidebar.collapsed")).toBe("true");
    expect(listener).toHaveBeenCalledTimes(1);
    toggleSidebar();
    expect(sidebarStore.getSnapshot()).toBe(false);
  });

  it("drops a subscriber that unsubscribed", () => {
    const listener = vi.fn();
    sidebarStore.subscribe(listener)();
    sidebarStore.set(true);
    expect(listener).not.toHaveBeenCalled();
  });
});
