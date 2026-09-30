/**
 * The attachment contract every parser, the store and the model path build against
 * (see "Attachments" in `docs/architecture.md`). Client-safe: no Node imports.
 *
 * A document is parsed once, on upload, into a `ParsedAttachment` written beside the original
 * as `<sha1>.json`. The transcript keeps only the small `StoredAttachment` descriptor; content
 * is hydrated at the last step before the provider, or read on demand by `read_attachment`.
 */

import type { ImageContent } from "@earendil-works/pi-ai";

export type AttachmentKind = "image" | "document" | "table" | "pdf";

/** What the transcript keeps for a document. Small; content stays on disk. */
export interface StoredAttachment {
  /** File name under the session's attachments dir: `<sha1>.<ext>`, content-addressed. */
  attachment: string;
  /** Original file name, sanitised; what the model and the UI call it. */
  name: string;
  kind: AttachmentKind;
  bytes: number;
  /** Estimate of the full normalised text, so budgets and context accounting need no disk read. */
  tokens: number;
  /** Pages, slides, sheets, or 1. */
  parts: number;
  /**
   * Rows across every table part, before any cap — what a spreadsheet's chip counts. Absent for a
   * document with no table in it, which is what tells the two apart without reading the parse.
   */
  rows?: number;
  /** A parser cap was hit; the normalised form is incomplete. */
  truncated?: boolean;
  /** PDF pages with no text layer (1-based). */
  scannedParts?: number[];
}

/** What a parser returns. Written to `<sha1>.json` beside the original, inside a `StoredParse`. */
export interface ParsedAttachment {
  version: 1;
  kind: AttachmentKind;
  parts: AttachmentPart[];
  /** Headings in reading order; `part` indexes `parts`. */
  outline: AttachmentOutlineEntry[];
  warnings: string[];
  /**
   * Set by a parser that hit one of its own caps and knows the normalised form is incomplete.
   * Optional: `parseAttachment` also derives it from a table whose rows were cut short, so a parser
   * that only fills `warnings` still produces a correct descriptor.
   */
  truncated?: boolean;
  /**
   * Pdf pages with no text layer (1-based). Optional for the same reason: `parseAttachment` falls
   * back to the pages whose text is shorter than `SCANNED_PAGE_MIN_CHARS`.
   */
  scannedParts?: number[];
}

/** Persisted sidecar containing the attachment descriptor and its parsed content. */
export interface StoredParse {
  version: 1;
  stored: StoredAttachment;
  parsed: ParsedAttachment;
}

export interface AttachmentOutlineEntry {
  part: number;
  level: number;
  title: string;
}

export type AttachmentPart = AttachmentTextPart | AttachmentTablePart;

/** Prose as Markdown. `label` is what the model sees: "Page 12", "Slide 3", "Section". */
export interface AttachmentTextPart {
  type: "text";
  label: string;
  markdown: string;
}

/**
 * A csv file or one worksheet. `rows` may be capped (see `limits.ts`); `totalRows` is the count
 * before the cap. Cells are numbers when they parse as one, ISO strings for dates, else text.
 */
export interface AttachmentTablePart {
  type: "table";
  label: string;
  columns: string[];
  rows: AttachmentCell[][];
  totalRows: number;
}

export type AttachmentCell = string | number | null;

/**
 * An image the user attached, as the transcript stores it: pi's own block shape, with the payload
 * on disk rather than in the session file. `data` is empty in the transcript; `convertToLlm`
 * hydrates the base64 from the attachment file before each model call. The limits are in
 * `src/lib/attachments/limits.ts` and the name format in `src/lib/attachments/formats.ts`.
 */
export interface StoredImage extends ImageContent {
  data: "";
  /** File name under `sessionAttachmentsDir(sessionId)`: `<sha1>.<ext>`, content-addressed. */
  attachment: string;
  /** Decoded size, so the UI and the limits can reason about it without reading the file. */
  bytes: number;
  width?: number;
  height?: number;
}

/** One image in the `POST /api/sessions/[id]/messages` body, base64 as the composer encoded it. */
export interface MessageImageInput {
  data: string;
  mimeType: string;
}
