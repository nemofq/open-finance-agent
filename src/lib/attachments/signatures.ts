/**
 * The magic bytes that say which container a file really is, whatever its name claims. Shared by
 * `parse/sniff.ts` on the request thread and by the parsers and zip checks in the parse worker, so
 * it imports nothing: the worker loads it from source.
 */

/** A zip's first local file header. Office Open XML (docx, pptx and xlsx) is a zip. */
export const ZIP = [0x50, 0x4b, 0x03, 0x04];
/** An empty zip, which a stripped-down Office file can legitimately start with. */
export const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
/** A spanned zip; Office does not write one, but the container is still a zip. */
export const ZIP_SPANNED = [0x50, 0x4b, 0x07, 0x08];
/**
 * OLE2 / CFB, the pre-2007 Office container: doc, xls, ppt and also msg. Office also wraps an Open
 * XML file in one when it puts a password on it.
 */
export const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** `%PDF`. A conforming file starts with it; the header may sit a few bytes in after junk. */
export const PDF = [0x25, 0x50, 0x44, 0x46];

/** Whether `bytes` holds `signature` at `offset`. */
export function hasSignature(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}
