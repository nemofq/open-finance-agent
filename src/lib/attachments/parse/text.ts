/**
 * Plain text and Markdown attachments (`md`, `txt`), and the text helpers the other document
 * parsers share: decoding, the character cap, and the one-part document with the outline that
 * `#`-headings contribute.
 *
 * Front matter is kept as text. It is part of what the user attached, it reads as prose, and
 * stripping it would silently drop the metadata a memo often carries in it.
 *
 * Caps truncate and warn; they never throw. Only unreadable input throws (`parse/index.ts` turns
 * that into an upload error), and a document we can read half of is still worth reading.
 */

import { MAX_TEXT_CHARS } from "../limits";
import type { AttachmentOutlineEntry, ParsedAttachment } from "../types";

/** The label a document with no page, slide or sheet structure carries. */
const DOCUMENT_LABEL = "Document";

/** CRLF and lone CR both become LF, so every parser downstream counts lines the same way. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Bytes as text. UTF-8 is assumed and its BOM dropped; a UTF-16 BOM is honoured because Windows
 * editors still write one. Invalid UTF-8 falls back to Latin-1, which cannot fail and keeps the
 * bytes legible, rather than filling the document with replacement characters.
 */
export function decodeText(bytes: Uint8Array): { text: string; warnings: string[] } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeWith(bytes, "utf-16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeWith(bytes, "utf-16be");
  try {
    return { text: normalizeNewlines(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), warnings: [] };
  } catch {
    const warning = "Not valid UTF-8; read as Latin-1. Some characters may be wrong.";
    return { ...decodeWith(bytes, "latin1"), warnings: [warning] };
  }
}

function decodeWith(bytes: Uint8Array, encoding: string): { text: string; warnings: string[] } {
  return { text: normalizeNewlines(new TextDecoder(encoding).decode(bytes)), warnings: [] };
}

/** The normalised text of any document, capped. `truncated` tells the caller a cap was hit. */
export function capText(text: string): { text: string; warnings: string[]; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS) return { text, warnings: [], truncated: false };
  return {
    text: text.slice(0, MAX_TEXT_CHARS),
    warnings: [`Too long to read in full; the first ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters were kept.`],
    truncated: true,
  };
}

/**
 * The `MAX_TEXT_CHARS` cap shared across the parts of a paged document: each call keeps what is
 * left of it, `cut` says the part did not fit, and `spent` that nothing was left before it.
 */
export function textBudget(): (text: string) => { text: string; cut: boolean; spent: boolean } {
  let used = 0;
  return (text) => {
    const room = MAX_TEXT_CHARS - used;
    used += Math.min(text.length, room);
    return { text: text.slice(0, room), cut: text.length > room, spent: room === 0 };
  };
}

const ATX_HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Headings in reading order, which is what the digest and the preview navigate by. Fenced code is
 * skipped, so a `# comment` in a shell block is not mistaken for a section.
 */
export function outlineFromMarkdown(markdown: string, part = 0): AttachmentOutlineEntry[] {
  const outline: AttachmentOutlineEntry[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const fenced = FENCE.exec(line)?.[1];
    if (fence) {
      // A fence closes on the same character, repeated at least as often as it was opened.
      if (fenced && fenced[0] === fence[0] && fenced.length >= fence.length) fence = null;
      continue;
    }
    if (fenced) {
      fence = fenced;
      continue;
    }
    const heading = ATX_HEADING.exec(line);
    if (heading?.[2]) outline.push({ part, level: heading[1].length, title: heading[2] });
  }
  return outline;
}

/**
 * A document that is one text part: `markdown` capped, the caller's `warnings` first, then the cap's
 * and an empty file's. `plain` text has no Markdown headings to outline.
 */
export function documentParse(name: string, markdown: string, options: { warnings: string[]; plain?: boolean }): ParsedAttachment {
  const capped = capText(markdown);
  const warnings = [...options.warnings, ...capped.warnings];
  if (!capped.text) warnings.push(`${name} has no text.`);
  return {
    version: 1,
    kind: "document",
    parts: [{ type: "text", label: DOCUMENT_LABEL, markdown: capped.text }],
    outline: options.plain ? [] : outlineFromMarkdown(capped.text),
    warnings,
    ...(capped.truncated ? { truncated: true } : {}),
  };
}

export async function parse(bytes: Uint8Array, name: string): Promise<ParsedAttachment> {
  const decoded = decodeText(bytes);
  return documentParse(name, decoded.text.trim(), { warnings: decoded.warnings });
}
