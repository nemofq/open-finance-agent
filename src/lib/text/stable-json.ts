export interface StableJsonOptions {
  /**
   * Leave out object keys whose value is `undefined`, as `JSON.stringify` does. By default they are
   * written as `null`, which the MCP cache and the benchmark's fixture keys were recorded with.
   */
  omitUndefined?: boolean;
}

/**
 * JSON with object keys sorted, so the same value serialises the same however its keys were
 * ordered: a cache key, a benchmark capture's request key, the duplicate-call check's argument
 * comparison, and an evidence entry's content hash.
 */
export function stableStringify(value: unknown, options: StableJsonOptions = {}): string {
  const write = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(write).join(",")}]`;
    if (item !== null && typeof item === "object") {
      const entries = Object.entries(item as Record<string, unknown>)
        .filter(([, entry]) => !options.omitUndefined || entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1));
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${write(entry)}`).join(",")}}`;
    }
    return JSON.stringify(item) ?? "null";
  };
  return write(value);
}
