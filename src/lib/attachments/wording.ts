/**
 * How the attachment readers write a count, a size and a caught error into the messages a user
 * sees. The parse worker loads nothing outside `src/lib/attachments/`, so this keeps its own copy
 * of `errorMessage` from `src/lib/utils.ts`; it imports nothing, so the worker can load it.
 */

/** A count with thousands separators: `2,000`. */
export function count(value: number): string {
  return value.toLocaleString("en-US");
}

/** Bytes as whole megabytes (MiB), the unit every cap is stated in. */
export function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/** What a caught value says: an `Error`'s message, or the value itself as a string. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
