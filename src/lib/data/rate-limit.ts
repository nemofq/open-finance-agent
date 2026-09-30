import { processSingleton } from "@/lib/process-state";

/**
 * A rolling-window limiter for sources that meter calls, such as Alpha Vantage's free tier
 * (5 calls/minute) or SEC EDGAR (10 requests/second). Calls over the limit wait for a slot; none
 * is ever dropped, because a research turn that loses a call silently loses a figure.
 */

export interface RateLimit {
  /** How many live calls may start inside one window. */
  calls: number;
  windowMs: number;
  /** Least time between two call starts, for servers that also meter per second. */
  minSpacingMs?: number;
}

export interface Limiter {
  /**
   * Resolves when a slot is free. Rejects when `signal` aborts while waiting: at once if the waiter
   * is already sleeping for its slot, otherwise once it reaches the head of the queue.
   */
  acquire(signal?: AbortSignal): Promise<void>;
}

function abortIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Request aborted.");
}

/** Rejects as soon as `signal` aborts, so a stopped waiter leaves the queue at once, not a window later. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Request aborted."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Waiters are served in order through a promise chain: letting them race would wake every
 * waiter at the same instant and start more calls than the window allows.
 */
export function createLimiter(limit: RateLimit): Limiter {
  const starts: number[] = [];
  let queue: Promise<void> = Promise.resolve();

  let last = -Infinity;

  async function take(signal?: AbortSignal): Promise<void> {
    for (;;) {
      abortIfCancelled(signal);
      const now = Date.now();
      while (starts.length > 0 && now - starts[0] >= limit.windowMs) starts.shift();
      const spacing = limit.minSpacingMs ?? 0;
      if (now - last < spacing) {
        await sleep(last + spacing - now, signal);
        continue;
      }
      if (starts.length < limit.calls) {
        starts.push(now);
        last = now;
        return;
      }
      await sleep(starts[0] + limit.windowMs - now, signal);
    }
  }

  return {
    acquire(signal) {
      // A rejected waiter must not break the chain for the ones behind it.
      const admitted = queue.then(() => take(signal));
      queue = admitted.catch(() => undefined);
      return admitted;
    },
  };
}

/** One set of limiters per process, so a rebuilt tool list, or Next's dev reload, keeps the window. */
function registry(): Map<string, Limiter> {
  return processSingleton("data.limiters", () => new Map<string, Limiter>());
}

/**
 * The limiter for one source, shared by every tool it serves: the quota is charged per key,
 * not per tool, and tools are rebuilt on every turn.
 */
export function limiterFor(key: string, limit: RateLimit): Limiter {
  // The limit is part of the id: limiters outlive a dev reload on globalThis, so an edited limit
  // starts a fresh window instead of leaving the old one in charge.
  const id = `${key}:${limit.calls}/${limit.windowMs}/${limit.minSpacingMs ?? 0}`;
  const existing = registry().get(id);
  if (existing) return existing;
  const created = createLimiter(limit);
  registry().set(id, created);
  return created;
}
