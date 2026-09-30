import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheDir } from "@/lib/paths";
import { cached, getCached, setCached } from "./cache";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-cache-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

const entryFile = () => path.join(cacheDir(), readdirSync(cacheDir())[0]);

describe("cached", () => {
  it("calls the loader once and serves the stored value afterwards", async () => {
    const load = vi.fn(async () => ({ price: 42 }));
    expect(await cached("quote:IBM", 60, load)).toEqual({ price: 42 });
    expect(await cached("quote:IBM", 60, load)).toEqual({ price: 42 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("gives distinct keys distinct entries", async () => {
    await cached("a", 60, async () => 1);
    await cached("b", 60, async () => 2);
    expect(await cached("a", 60, async () => 99)).toBe(1);
    expect(await cached("b", 60, async () => 99)).toBe(2);
  });

  it("reloads once the entry has expired", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => Date.now());
    const first = await cached("stale", 10, load);
    vi.advanceTimersByTime(11_000);
    expect(await cached("stale", 10, load)).not.toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reloads on refresh and serves the refreshed value afterwards", async () => {
    await cached("catalog", 60, async () => "old");
    expect(await cached("catalog", 60, async () => "new", { refresh: true })).toBe("new");
    expect(await cached("catalog", 60, async () => "later")).toBe("new");
  });

  it("treats a corrupt entry as a miss and overwrites it", async () => {
    await cached("corrupt", 60, async () => "good");
    writeFileSync(entryFile(), "{not json");
    expect(await cached("corrupt", 60, async () => "fresh")).toBe("fresh");
    expect(await cached("corrupt", 60, async () => "later")).toBe("fresh");
  });
});

describe("getCached and setCached", () => {
  it("reads nothing before a write and the value after one", async () => {
    expect(await getCached("profile:IBM")).toBeUndefined();
    await setCached("profile:IBM", 60, { sector: "Technology" });
    expect(await getCached("profile:IBM")).toEqual({ sector: "Technology" });
  });

  it("shares entries with cached, either way round", async () => {
    await setCached("quote:MSFT", 60, 410);
    const load = vi.fn(async () => 0);
    expect(await cached("quote:MSFT", 60, load)).toBe(410);
    expect(load).not.toHaveBeenCalled();
    await cached("quote:AAPL", 60, async () => 190);
    expect(await getCached("quote:AAPL")).toBe(190);
  });

  it("reads an expired or corrupt entry as nothing", async () => {
    vi.useFakeTimers();
    await setCached("stale", 10, "old");
    vi.advanceTimersByTime(11_000);
    expect(await getCached("stale")).toBeUndefined();
    writeFileSync(entryFile(), "{not json");
    expect(await getCached("stale")).toBeUndefined();
  });
});
