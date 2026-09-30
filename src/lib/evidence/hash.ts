import { createHash } from "node:crypto";
import { stableStringify } from "@/lib/text/stable-json";

/**
 * SHA-256 of a value's JSON with sorted keys, hex encoded, so a result replayed from a benchmark
 * cassette hashes the same as the live call that recorded it.
 */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value, { omitUndefined: true })).digest("hex");
}
