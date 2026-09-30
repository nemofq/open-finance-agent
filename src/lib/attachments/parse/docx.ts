/**
 * Word 2007+ `.docx`: `mammoth` maps the document's styles onto HTML, which `html.ts` turns into
 * Markdown. Headings, lists and tables survive that route; page numbers do not exist in the format
 * at all, so a docx is one part.
 *
 * A docx is a zip, and a zip from an untrusted user may be a bomb. The central directory is read
 * first — it declares entry count and uncompressed sizes without inflating a single byte — so an
 * oversized archive is refused before mammoth opens it.
 */

import mammoth from "mammoth";
import type { ParsedAttachment } from "../types";
import { inspectZip, ZipTooLarge } from "../zip";
import { htmlToMarkdown } from "./html";
import { documentParse } from "./text";

/** The caps come from the central directory, so an oversized archive never reaches mammoth. */
async function checkArchive(bytes: Uint8Array, name: string): Promise<void> {
  try {
    await inspectZip(bytes, name);
  } catch (error) {
    if (error instanceof ZipTooLarge) throw error;
    throw new Error(`${name} is damaged and could not be opened.`);
  }
}

export async function parse(bytes: Uint8Array, name: string): Promise<ParsedAttachment> {
  await checkArchive(bytes, name);

  let html: string;
  let messages: readonly { type: string; message: string }[];
  try {
    ({ value: html, messages } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }));
  } catch (error) {
    throw new Error(`${name} could not be read as a Word document.`, { cause: error });
  }

  // Mammoth reports an unmapped style as a warning on every paragraph that uses it, which is noise;
  // only what it could not read at all is worth showing.
  const warnings = messages.filter((message) => message.type === "error").map((message) => message.message);
  return documentParse(name, await htmlToMarkdown(html), { warnings });
}
