import type { ZodError } from "zod";

/**
 * A random id for the browser. `crypto.randomUUID` exists only in secure contexts (https and
 * localhost), so a dev server reached through a forwarded hostname over plain http has no such
 * function; the fallback is plenty for keys and idempotency tokens made on the client.
 */
export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * A `randomUUID` id, which is what names every chat, task and run on disk; anything else in a path
 * must never reach the filesystem.
 */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a caught value says: an `Error`'s message, or the value itself as a string. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A zod failure as one readable sentence per issue, `path: message`, joined with `; `. `whole`
 * stands in for the path of an issue with the value as a whole.
 */
export function formatZodIssues(err: ZodError, whole: string): string {
  return err.issues.map((issue) => `${issue.path.join(".") || whole}: ${issue.message}`).join("; ");
}

/** A plain JSON-style object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality that ignores key order and keys set to undefined, as JSON does. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => deepEqual(a[key], b[key]));
}

/**
 * Merge `override` onto `base`: plain objects merge key by key, every other value
 * (arrays included) replaces wholesale, and `undefined` leaves the base untouched.
 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (!isRecord(base) || !isRecord(override)) return override as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out as T;
}
