import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoredValue } from "./stored-value";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
});

afterEach(() => storage.clear());

const mode = () => createStoredValue<"date" | "ticker">("test.mode", (raw) => (raw === "date" || raw === "ticker" ? raw : undefined), "date");

describe("createStoredValue", () => {
  it("reads the fallback until something readable is stored", () => {
    const store = mode();
    expect(store.getSnapshot()).toBe("date");
    storage.set("test.mode", "calendar");
    expect(store.getSnapshot()).toBe("date");
    storage.set("test.mode", "ticker");
    expect(store.getSnapshot()).toBe("ticker");
  });

  it("writes under its key and tells subscribers until they leave", () => {
    const store = mode();
    const listener = vi.fn();
    const leave = store.subscribe(listener);
    store.set("ticker");
    expect(storage.get("test.mode")).toBe("ticker");
    expect(listener).toHaveBeenCalledTimes(1);
    leave();
    store.set("date");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("serves its own value to the server, and serialises as asked", () => {
    const dismissed = createStoredValue("test.hint", (raw) => raw === "dismissed", false, {
      serialize: (value) => (value ? "dismissed" : ""),
      serverValue: true,
    });
    expect(dismissed.getServerSnapshot()).toBe(true);
    expect(dismissed.getSnapshot()).toBe(false);
    dismissed.set(true);
    expect(storage.get("test.hint")).toBe("dismissed");
    expect(dismissed.getSnapshot()).toBe(true);
  });

  it("falls back when storage refuses to be read", () => {
    const store = mode();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(store.getSnapshot()).toBe("date");
    expect(() => store.set("ticker")).not.toThrow();
  });
});
