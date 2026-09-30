import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLimiter, limiterFor } from "./rate-limit";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** When each call was admitted, so the window can be checked against the clock. */
async function admit(limiter: { acquire(): Promise<void> }, count: number): Promise<number[]> {
  const at: number[] = [];
  const waiting = Array.from({ length: count }, () =>
    limiter.acquire().then(() => {
      at.push(Date.now());
    }),
  );
  // Long enough for every waiter to have had its slot, whatever the window.
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  await Promise.all(waiting);
  return at;
}

describe("createLimiter", () => {
  it("admits a full window at once", async () => {
    const limiter = createLimiter({ calls: 5, windowMs: 60_000 });
    const start = Date.now();
    expect(await admit(limiter, 5)).toEqual([start, start, start, start, start]);
  });

  it("makes the calls over the limit wait for the window to roll", async () => {
    const start = Date.now();
    const limiter = createLimiter({ calls: 5, windowMs: 60_000 });
    const at = await admit(limiter, 8);

    expect(at.slice(0, 5)).toEqual([start, start, start, start, start]);
    // The first five expire together, so the next three start one window later.
    expect(at.slice(5)).toEqual([start + 60_000, start + 60_000, start + 60_000]);
  });

  it("spaces call starts apart when the server also meters per second", async () => {
    const limiter = createLimiter({ calls: 5, windowMs: 60_000, minSpacingMs: 1_100 });
    const start = Date.now();
    const at = await admit(limiter, 3);
    expect(at).toEqual([start, start + 1_100, start + 2_200]);
  });

  it("never drops a call", async () => {
    const limiter = createLimiter({ calls: 2, windowMs: 1_000 });
    expect(await admit(limiter, 7)).toHaveLength(7);
  });

  it("lets a later call through once the window has passed on its own", async () => {
    const limiter = createLimiter({ calls: 2, windowMs: 1_000 });
    await admit(limiter, 2);
    const later = Date.now();
    expect(await admit(limiter, 1)).toEqual([later]);
  });

  it("rejects a waiter whose request was aborted, without blocking the queue", async () => {
    const limiter = createLimiter({ calls: 1, windowMs: 60_000 });
    await limiter.acquire();

    const controller = new AbortController();
    const aborted = limiter.acquire(controller.signal);
    const next = limiter.acquire();
    controller.abort();

    await expect(aborted).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(next).resolves.toBeUndefined();
  });

  it("rejects a waiter aborted while it sleeps at once, rather than when its slot comes", async () => {
    const limiter = createLimiter({ calls: 1, windowMs: 60_000 });
    await limiter.acquire();

    const controller = new AbortController();
    const aborted = limiter.acquire(controller.signal);
    const rejected = aborted.then(() => false, () => true);
    const next = limiter.acquire();
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(await Promise.race([rejected, Promise.resolve("still waiting")])).toBe(true);
    await expect(aborted).rejects.toThrow("Request aborted.");
    await vi.advanceTimersByTimeAsync(59_000);
    await expect(next).resolves.toBeUndefined();
  });
});

describe("limiterFor", () => {
  it("shares one window per server, so every tool draws on the same quota", () => {
    const limit = { calls: 5, windowMs: 60_000 };
    expect(limiterFor("alphavantage", limit)).toBe(limiterFor("alphavantage", limit));
    expect(limiterFor("alphavantage", limit)).not.toBe(limiterFor("other-server", limit));
  });

  it("starts a fresh window when the limit itself changes", () => {
    expect(limiterFor("alphavantage", { calls: 5, windowMs: 60_000 })).not.toBe(
      limiterFor("alphavantage", { calls: 75, windowMs: 60_000 }),
    );
  });
});
