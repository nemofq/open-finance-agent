/**
 * Word 97–2003 `.doc`. Best effort by design, and the parser says so in a warning: the binary
 * format stores text in a piece table with formatting in a parallel stream, so `word-extractor`
 * recovers the body text and nothing else. Headings, lists and tables come back as plain lines —
 * a user who needs structure is better served saving the file as `.docx`.
 *
 * It is one part: `.doc` has no page breaks that survive without laying the document out.
 */

import WordExtractor from "word-extractor";
import type { ParsedAttachment } from "../types";
import { documentParse, normalizeNewlines } from "./text";

const BEST_EFFORT = "Read as plain text: a Word 97–2003 file keeps no structure we can recover. Save it as .docx for headings, lists and tables.";

/**
 * `word-extractor` has already turned Word's markers into tabs and newlines; what is left are the
 * control characters it had no mapping for, and the blank runs an empty paragraph leaves behind.
 */
function tidy(text: string): string {
  return normalizeNewlines(text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parse(bytes: Uint8Array, name: string): Promise<ParsedAttachment> {
  let body: string;
  try {
    const document = await new WordExtractor().extract(Buffer.from(bytes));
    body = document.getBody();
  } catch (error) {
    // The same failure covers a damaged file and a password-protected one: Word 97 encrypts the
    // streams, so the extractor cannot tell us which, and neither can we.
    throw new Error(`${name} could not be read. It may be damaged or password-protected.`, { cause: error });
  }

  return documentParse(name, tidy(body), { warnings: [BEST_EFFORT], plain: true });
}
