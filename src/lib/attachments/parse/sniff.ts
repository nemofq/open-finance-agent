/**
 * Which parser gets the bytes.
 *
 * The extension alone is a claim by whoever named the file. A `.txt` that is really a zip would
 * otherwise reach the text decoder, and a `.csv` that is really an OLE2 compound file would reach
 * `csv-parse`; neither is dangerous on its own, but the point of the container check is that a
 * parser only ever sees the container it was written for. So the container decides first and the
 * extension only picks between the formats that share it.
 *
 * Client-safe: no Node imports, so the composer could sniff a `File` slice too.
 */

import { type Container, DOCUMENT_TYPES, type DocumentType, extensionOf, rejected } from "../formats";
import { hasSignature, OLE2, PDF, ZIP, ZIP_EMPTY, ZIP_SPANNED } from "../signatures";

/**
 * The container these bytes are in. `%PDF` is searched for in the first kilobyte rather than at
 * byte zero: generators prepend whitespace and stray bytes often enough that pdf.js itself scans
 * for the header, and a file we refused here would be one the user can open in any reader.
 */
export function sniffContainer(bytes: Uint8Array): Container {
  if (hasSignature(bytes, ZIP) || hasSignature(bytes, ZIP_EMPTY) || hasSignature(bytes, ZIP_SPANNED)) return "zip";
  if (hasSignature(bytes, OLE2)) return "ole2";
  const head = bytes.subarray(0, 1024);
  for (let offset = 0; offset + PDF.length <= head.length; offset += 1) {
    if (hasSignature(head, PDF, offset)) return "pdf";
  }
  return "plain";
}

/** The Open XML formats, which are zips until someone puts a password on one. */
const OOXML = new Set(["docx", "xlsx", "pptx"]);

/** Bad input from the composer or a hand-made request, surfaced as a 400 rather than a 500. */
export class UnsupportedAttachment extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedAttachment";
  }
}

export interface Sniffed extends DocumentType {
  extension: string;
  container: Container;
}

/**
 * Decide how to parse `name`'s bytes, or explain why we will not.
 *
 * `.pdf` is the one case where the container overrules the extension outright: a pdf is
 * self-describing and there is nothing else it could be, so a `%PDF` file called `report.txt` is
 * still parsed as a pdf. Everywhere else a mismatch is refused, because a zip could be any of
 * three Office formats and only the name says which.
 */
export function sniff(bytes: Uint8Array, name: string): Sniffed {
  const extension = extensionOf(name);
  const container = sniffContainer(bytes);

  if (bytes.length === 0) throw new UnsupportedAttachment(`${name} is empty.`);

  const explained = rejected(name);
  if (explained) throw new UnsupportedAttachment(`.${extension} files are not supported — ${explained}.`);

  if (container === "pdf") return { ...DOCUMENT_TYPES.pdf, extension: "pdf", container };

  const type = DOCUMENT_TYPES[extension];
  if (!type) {
    throw new UnsupportedAttachment(
      extension ? `.${extension} files cannot be attached.` : `${name} has no file extension, so there is no way to tell what it is.`,
    );
  }
  // Office protects an Open XML file by encrypting the zip and wrapping it in an OLE2 container, so
  // this pairing is hardly ever a misnamed file — it is the one thing the user can actually undo.
  // It comes before the container rule below, which would refuse the file too but name no fix.
  if (container === "ole2" && OOXML.has(extension)) {
    throw new UnsupportedAttachment(`${name} is password-protected. Remove the password and attach it again.`);
  }
  if (!type.containers.includes(container)) {
    throw new UnsupportedAttachment(`${name} is not really a .${extension} file: ${describe(container)}. Save it again in the format it is named for.`);
  }
  return { ...type, extension, container };
}

function describe(container: Container): string {
  if (container === "zip") return "its contents are a zip archive";
  if (container === "ole2") return "its contents are an old binary Office file";
  if (container === "pdf") return "its contents are a pdf";
  return "its contents are plain bytes, not the format's own container";
}
