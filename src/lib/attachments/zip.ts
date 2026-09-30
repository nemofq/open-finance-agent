/**
 * The zip checks an Open XML file goes through before a reader inflates it, shared by the
 * attachment parsers (in the parse worker) and the holdings import (on the request thread).
 *
 * A zip's central directory says what the archive claims to hold before a single byte is inflated,
 * so a bomb is refused for what it would cost. The sizes are the archive's own word: in the worker,
 * its memory and time limits are what stops a file that lies about them.
 *
 * Loaded by the parse worker, so it must stay erasable TypeScript: plain fields,
 * no parameter properties, `import type` for types.
 */

import JSZip from "jszip";
import { MAX_ZIP_DECOMPRESSED_BYTES, MAX_ZIP_ENTRIES } from "./limits";
import { hasSignature, OLE2 } from "./signatures";
import { count, megabytes } from "./wording";

/** An archive over one of the zip caps, going by its central directory. */
export class ZipTooLarge extends Error {
  readonly limit: "entries" | "decompressedBytes";
  readonly actual: number;
  readonly max: number;

  constructor(limit: "entries" | "decompressedBytes", actual: number, max: number, message: string) {
    super(message);
    this.name = "ZipTooLarge";
    this.limit = limit;
    this.actual = actual;
    this.max = max;
  }
}

/**
 * Open a zip's central directory and refuse it over `MAX_ZIP_ENTRIES` entries or
 * `MAX_ZIP_DECOMPRESSED_BYTES` of declared content, with `ZipTooLarge`. Nothing is inflated.
 *
 * An Open XML file with a password is an OLE2 container, not a zip, and is refused as that; a zip
 * whose entries are encrypted, and bytes that are no zip at all, reject with JSZip's own error.
 */
export async function inspectZip(bytes: Uint8Array, name: string): Promise<JSZip> {
  if (hasSignature(bytes, OLE2)) {
    throw new Error(`${name} is password-protected. Remove the password and try again.`);
  }
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new ZipTooLarge("entries", entries.length, MAX_ZIP_ENTRIES, `${name} holds ${count(entries.length)} zip entries; the limit is ${count(MAX_ZIP_ENTRIES)}.`);
  }
  // jszip keeps the declared size on the entry's compressed data; there is no public accessor.
  const decompressedBytes = entries.reduce(
    (total, entry) => total + ((entry as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0),
    0,
  );
  if (decompressedBytes > MAX_ZIP_DECOMPRESSED_BYTES) {
    throw new ZipTooLarge("decompressedBytes", decompressedBytes, MAX_ZIP_DECOMPRESSED_BYTES, `${name} unpacks to more than ${megabytes(MAX_ZIP_DECOMPRESSED_BYTES)} MB.`);
  }
  return zip;
}
