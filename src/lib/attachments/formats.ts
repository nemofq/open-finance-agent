/**
 * Attachments: which files are taken, what each one is, and the names they are stored under. The
 * one table a new format adds a row to. Client-safe on purpose — the composer builds its `accept`
 * attribute and greys out a file from here — so this module imports no parser, no Node module and
 * nothing that does: which code actually turns the bytes into parts is `parse/registry.ts`, and
 * only the worker imports that.
 *
 * Files live under `sessionAttachmentsDir(sessionId)` (see `src/lib/paths.ts`), or under
 * `stagingDir()` until a chat claims them, and are named by content hash, so a name is immutable
 * and may be cached forever. The size, count and time limits are in `limits.ts`.
 */

import type { AttachmentKind } from "./types";

/* ---------------------------------------------------------------- images */

/** Mime type → file extension. The keys are the only types accepted anywhere. */
export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const IMAGE_MIME_TYPES = Object.keys(IMAGE_EXTENSIONS);

export function isImageMimeType(type: string): boolean {
  return Object.hasOwn(IMAGE_EXTENSIONS, type);
}

/* ------------------------------------------------------------- documents */

/** What the first few bytes say a file is, before anyone looks at its name (see `parse/sniff.ts`). */
export type Container = "pdf" | "zip" | "ole2" | "plain";

/** What one supported document extension is worth: who parses it, what it becomes, how it serves. */
interface DocumentRow {
  /** Which module under `parse/` turns these bytes into a `ParsedAttachment`. */
  parser: string;
  kind: AttachmentKind;
  /**
   * Which containers the parser is willing to be handed. The sniff refuses a file whose bytes are
   * in any other container, so a parser only ever sees the container it was written for.
   */
  containers: readonly Container[];
  /** The type the file really is, used for the download the serve route hands back. */
  mimeType: string;
}

const DOCUMENT_ROWS = {
  md: { parser: "text", kind: "document", containers: ["plain"], mimeType: "text/markdown" },
  txt: { parser: "text", kind: "document", containers: ["plain"], mimeType: "text/plain" },
  html: { parser: "html", kind: "document", containers: ["plain"], mimeType: "text/html" },
  htm: { parser: "html", kind: "document", containers: ["plain"], mimeType: "text/html" },
  docx: { parser: "docx", kind: "document", containers: ["zip"], mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  doc: { parser: "legacy-doc", kind: "document", containers: ["ole2"], mimeType: "application/msword" },
  pptx: { parser: "pptx", kind: "document", containers: ["zip"], mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  // A real `.xlsx` is a zip and csv is plain; a workbook saved under the other name is read by its
  // bytes, so both containers reach the same parser.
  csv: { parser: "tabular", kind: "table", containers: ["zip", "plain"], mimeType: "text/csv" },
  xlsx: { parser: "tabular", kind: "table", containers: ["zip", "plain"], mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  pdf: { parser: "pdf", kind: "pdf", containers: ["pdf"], mimeType: "application/pdf" },
} as const satisfies Record<string, DocumentRow>;

/**
 * Every parser the table names. `parse/registry.ts` must have a loader for each, and fails to
 * typecheck until it does.
 */
export type ParserId = (typeof DOCUMENT_ROWS)[keyof typeof DOCUMENT_ROWS]["parser"];

export type DocumentType = DocumentRow & { parser: ParserId };

/** Mapping of supported file extensions to parser configuration and MIME types. */
export const DOCUMENT_TYPES: Record<string, DocumentType> = DOCUMENT_ROWS;

const DOCUMENT_EXTENSIONS = Object.keys(DOCUMENT_TYPES);

/**
 * Formats we recognise well enough to explain, rather than refusing as "unsupported". Office has
 * saved `.pptx` and `.xlsx` since 2007, so for the old binary `.ppt` and `.xls` the fix is one Save
 * As away. `.ppt`'s format is a different problem from `.doc`; `.xls` needs a reader of its own,
 * and the only maintained one is not published to the npm registry.
 */
const REJECTED_EXTENSIONS: Record<string, string> = {
  ppt: "Save as .pptx and attach again",
  xls: "Save as .xlsx or .csv and attach again",
};

/** Lower-case extension of a file name, without the dot; empty for a name that has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * The handling for a file the user picked, or undefined for one we do not take. Client-safe, so the
 * composer can grey a file out before uploading it; the server repeats the check and sniffs the
 * bytes, because nothing a browser sends is trusted.
 */
export function supported(name: string): DocumentType | undefined {
  return DOCUMENT_TYPES[extensionOf(name)];
}

/** The explanation for a format we refuse on purpose, or undefined when there is nothing to say. */
export function rejected(name: string): string | undefined {
  return REJECTED_EXTENSIONS[extensionOf(name)];
}

/** The `accept` attribute for the composer's file input: every image type plus every document. */
export const accept = [...IMAGE_MIME_TYPES, ...DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`)].join(",");

/* ----------------------------------------------------------------- names */

/** `<sha1 hex>.<ext>`; anything else must never reach the filesystem. */
export const ATTACHMENT_NAME = new RegExp(`^[0-9a-f]{40}\\.(${[...Object.values(IMAGE_EXTENSIONS), ...DOCUMENT_EXTENSIONS].join("|")})$`);

/**
 * The parse written beside a document as `<sha1>.json`. It is the model's view of the file, not the
 * file, and is never served: `attachmentPath` refuses it and the serve route matches only
 * `ATTACHMENT_NAME`, which cannot match `.json` because no document extension is `json`.
 */
export function parsedName(name: string): string {
  return `${name.slice(0, 40)}.json`;
}

export function mimeTypeOfAttachment(name: string): string | undefined {
  const ext = extensionOf(name);
  const image = Object.entries(IMAGE_EXTENSIONS).find(([, candidate]) => candidate === ext)?.[0];
  return image ?? DOCUMENT_TYPES[ext]?.mimeType;
}

/**
 * The `Content-Type` the serve route actually sends. It is the real type for everything but html,
 * which is handed back as text: uploaded markup must never run in our origin, and `nosniff` alone
 * would not stop a browser that was told the file is html.
 */
export function servedTypeOfAttachment(name: string): string | undefined {
  const type = mimeTypeOfAttachment(name);
  return type === "text/html" ? "text/plain; charset=utf-8" : type;
}

/** True for a stored name that is a document rather than an image. */
export function isDocumentName(name: string): boolean {
  return DOCUMENT_EXTENSIONS.includes(extensionOf(name));
}

/* ------------------------------------------------------------------ urls */

/** Where the browser fetches an image or a document's original file; served by `GET /api/sessions/[id]/attachments/[name]`. */
export function attachmentUrl(sessionId: string, name: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(name)}`;
}

/** The normalised Markdown behind a document, for the preview dialog. */
export function documentTextUrl(sessionId: string, name: string): string {
  return `${attachmentUrl(sessionId, name)}/text`;
}

/** Where a document is uploaded before any chat exists. */
export const UPLOAD_URL = "/api/attachments";
