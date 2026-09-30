import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@/lib/atomic-write";
import { cacheDir, ensureDataDirs } from "@/lib/paths";

type Entry<T> = { expiresAt: number; value: T };

function entryPath(key: string): string {
  return path.join(cacheDir(), `${createHash("sha1").update(key).digest("hex")}.json`);
}

async function readEntry<T>(file: string): Promise<Entry<T> | null> {
  try {
    const entry = JSON.parse(await readFile(file, "utf8")) as Entry<T>;
    return typeof entry?.expiresAt === "number" && entry.expiresAt > Date.now() ? entry : null;
  } catch {
    return null; // missing, stale or corrupt entries are simply a miss
  }
}

/**
 * The live value stored under `key`, or undefined when there is none: never written, expired or
 * unreadable. For a caller that fills the cache itself, such as a batch that fetches only its misses.
 */
export async function getCached<T>(key: string): Promise<T | undefined> {
  return (await readEntry<T>(entryPath(key)))?.value;
}

/** Store `value` under `key` for `ttlSeconds`, replacing whatever was there. Never throws. */
export async function setCached<T>(key: string, ttlSeconds: number, value: T): Promise<void> {
  ensureDataDirs();
  const entry: Entry<T> = { expiresAt: Date.now() + ttlSeconds * 1000, value };
  try {
    await writeFileAtomic(entryPath(key), JSON.stringify(entry));
  } catch {
    // A cache that cannot be written must not fail the caller.
  }
}

/**
 * Run `fn` and cache its result on disk for `ttlSeconds`, keyed by an arbitrary string.
 * `refresh` skips a live entry and overwrites it with the new result.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  options?: { refresh?: boolean },
): Promise<T> {
  const hit = options?.refresh ? null : await readEntry<T>(entryPath(key));
  if (hit) return hit.value;
  const value = await fn();
  await setCached(key, ttlSeconds, value);
  return value;
}
