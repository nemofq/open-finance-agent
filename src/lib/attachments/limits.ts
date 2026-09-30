/**
 * Attachments: the limits both the composer and the server go by — counts, bytes, text, tables,
 * archives, time and heap. Client-safe, no imports at all. Which files are taken and what they are
 * called is `formats.ts`.
 */

export const MAX_IMAGES_PER_MESSAGE = 4;

/** Decoded bytes per image, after the composer has downsized it. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The composer scales a longer edge down to this before uploading; providers do the same anyway. */
export const MAX_IMAGE_EDGE = 1568;

/* ------------------------------------------------------------- documents */

export const MAX_DOCUMENTS_PER_MESSAGE = 5;

/** Original file size, before parsing. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/**
 * Parser caps. An attachment that hits one is truncated with a warning
 * (`StoredAttachment.truncated`); portfolio import instead refuses a table over the row or column
 * cap. The table byte cap stays under the sandbox IPC line cap (8 MB).
 */
export const MAX_TABLE_ROWS = 50_000;
export const MAX_TABLE_COLUMNS = 200;
export const MAX_TABLE_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_CHARS = 2_000_000;
export const MAX_ZIP_ENTRIES = 2_000;
export const MAX_ZIP_DECOMPRESSED_BYTES = 200 * 1024 * 1024;
/** A pdf page with fewer extracted characters than this is treated as scanned. */
export const SCANNED_PAGE_MIN_CHARS = 40;
/** Worker thread budget for one parse. */
export const PARSE_TIMEOUT_MS = 30_000;
export const PARSE_MAX_OLD_GENERATION_MB = 512;

/** Staged uploads older than this are swept, on server start and on every upload. */
export const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
