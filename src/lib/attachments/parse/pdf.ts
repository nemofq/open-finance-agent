/**
 * pdf → one Markdown part per page, from the text layer alone.
 *
 * pdf.js hands back positioned glyph runs, not lines: a page is an unordered bag of items, each
 * with a transform. Lines are rebuilt by grouping items on their baseline, ordering them left to
 * right, and starting a paragraph where the vertical gap jumps. Multi-column reports come out
 * column-merged; v1 accepts that.
 *
 * A page whose text layer is empty or nearly so was scanned, not typeset. Those pages are listed
 * in `warnings` and derived structurally by `scannedPages`, which the model path uses to decide
 * which pages to render as images.
 */
import { MAX_TEXT_CHARS, SCANNED_PAGE_MIN_CHARS } from "../limits";
import type { AttachmentOutlineEntry, AttachmentPart, ParsedAttachment } from "../types";
import { errorMessage } from "../wording";
import { textBudget } from "./text";

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
type TextContent = Awaited<ReturnType<PdfPage["getTextContent"]>>;
type PdfRef = Parameters<PdfDocument["getPageIndex"]>[0];

/**
 * The legacy build is the one that runs outside a browser. In Node pdf.js falls back to its
 * in-process worker on its own, so the text layer needs no worker file and no canvas; the build is
 * several megabytes, so it is loaded on first use and kept.
 */
let pdfjs: Promise<Pdfjs> | undefined;
function load(): Promise<Pdfjs> {
  pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs;
}

/* ------------------------------------------------------------- lines */

interface Item {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

interface Line {
  y: number;
  height: number;
  items: Item[];
}

/** Baselines within this fraction of a line's height are the same line. */
const LINE_TOLERANCE = 0.5;
/** A vertical gap of more than this many line heights ends the paragraph. */
const PARAGRAPH_GAP = 1.8;
/** A horizontal gap of more than this fraction of the line height is a space between words. */
const WORD_GAP = 0.2;
/** Items carry no height when the font size is unknown; a text page is 12pt more often than not. */
const DEFAULT_HEIGHT = 12;

/** The positioned runs of a page; marked-content markers, when asked for, carry no position. */
function itemsOf(content: TextContent): Item[] {
  const items: Item[] = [];
  for (const item of content.items) {
    if (!("str" in item)) continue;
    items.push({
      height: item.height || DEFAULT_HEIGHT,
      text: item.str,
      width: item.width,
      x: Number(item.transform[4]),
      y: Number(item.transform[5]),
    });
  }
  return items;
}

/** Items grouped onto baselines, the page top first and each line left to right. */
function linesOf(items: Item[]): Line[] {
  const lines: Line[] = [];
  for (const item of items) {
    const line = lines.find(
      (candidate) => Math.abs(candidate.y - item.y) <= Math.max(candidate.height, item.height) * LINE_TOLERANCE,
    );
    if (!line) lines.push({ height: item.height, items: [item], y: item.y });
    else {
      line.items.push(item);
      line.height = Math.max(line.height, item.height);
    }
  }
  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** Runs that touch make one word; a gap between them is a space, however wide it is. */
function textOf(line: Line): string {
  let text = "";
  let end: number | undefined;
  for (const item of line.items) {
    if (!item.text) continue;
    if (end !== undefined && item.x - end > line.height * WORD_GAP) text += " ";
    text += item.text;
    end = item.x + item.width;
  }
  return text.replace(/\s+/g, " ").trim();
}

function markdownOf(lines: Line[]): string {
  const rendered: string[] = [];
  let previous: Line | undefined;
  for (const line of lines) {
    const text = textOf(line);
    if (!text) continue;
    const gap = previous ? previous.y - line.y : 0;
    if (previous && gap > Math.max(previous.height, line.height) * PARAGRAPH_GAP) rendered.push("");
    rendered.push(text);
    previous = line;
  }
  return rendered.join("\n").trim();
}

/* ------------------------------------------------------------- outline */

/** Deep or wide outlines are a sign of a generated document, not of a reader's table of contents. */
const MAX_OUTLINE_ENTRIES = 1_000;
const MAX_OUTLINE_DEPTH = 6;

type OutlineNode = Awaited<ReturnType<PdfDocument["getOutline"]>>[number];

/** The page an outline destination points at, 0-based, or nothing when it cannot be resolved. */
async function pageOf(doc: PdfDocument, dest: OutlineNode["dest"]): Promise<number | undefined> {
  try {
    const target = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    const ref: unknown = Array.isArray(target) ? target[0] : undefined;
    if (!ref || typeof ref !== "object") return undefined;
    return await doc.getPageIndex(ref as PdfRef);
  } catch {
    return undefined;
  }
}

/** The PDF's own outline, flattened to entries against the page each one opens. */
async function outlineOf(doc: PdfDocument): Promise<AttachmentOutlineEntry[]> {
  const entries: AttachmentOutlineEntry[] = [];
  const walk = async (nodes: OutlineNode[], level: number): Promise<void> => {
    for (const node of nodes) {
      if (entries.length >= MAX_OUTLINE_ENTRIES) return;
      const page = await pageOf(doc, node.dest);
      const title = node.title.replace(/\s+/g, " ").trim();
      if (page !== undefined && title) entries.push({ level, part: page, title });
      if (level < MAX_OUTLINE_DEPTH) await walk((node.items ?? []) as OutlineNode[], level + 1);
    }
  };
  // A PDF without an outline answers `null`, whatever the published types say.
  await walk((await doc.getOutline()) ?? [], 1);
  return entries;
}

/* ------------------------------------------------------------- parse */

/**
 * The pages with no usable text layer, 1-based. `parse` puts them on the parse as `scannedParts`,
 * and this derives them again from the parts alone, so a sidecar read back from disk needs no
 * second pass over the pdf to know which pages only exist as images.
 */
export function scannedPages(parsed: ParsedAttachment): number[] {
  if (parsed.kind !== "pdf") return [];
  const pages: number[] = [];
  parsed.parts.forEach((part, index) => {
    if (part.type === "text" && part.markdown.trim().length < SCANNED_PAGE_MIN_CHARS) pages.push(index + 1);
  });
  return pages;
}

/** Enough page numbers to act on, not a wall of them for a file that was scanned end to end. */
function listPages(pages: number[]): string {
  const shown = pages.slice(0, 20).join(", ");
  return pages.length > 20 ? `${shown} and ${pages.length - 20} more` : shown;
}

function readable(error: unknown, name: string): Error {
  if (error instanceof Error && error.name === "PasswordException") {
    return new Error(`${name} is password-protected. Remove the password and attach it again.`, { cause: error });
  }
  return new Error(`${name} is not a readable PDF file.`, { cause: error });
}

export async function parse(bytes: Uint8Array, name: string): Promise<ParsedAttachment> {
  const { VerbosityLevel, getDocument } = await load();
  // pdf.js takes ownership of the array it is given, so it gets a copy of the caller's bytes.
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: VerbosityLevel.ERRORS });

  let doc: PdfDocument;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy();
    throw readable(error, name);
  }

  const parts: AttachmentPart[] = [];
  const warnings: string[] = [];
  let outline: AttachmentOutlineEntry[] = [];
  let truncated = false;
  try {
    const budget = textBudget();
    for (let number = 1; number <= doc.numPages; number += 1) {
      let markdown = "";
      try {
        const page = await doc.getPage(number);
        markdown = markdownOf(linesOf(itemsOf(await page.getTextContent())));
        page.cleanup();
      } catch (error) {
        // A page that will not parse still gets a part, so page numbers stay the part numbers.
        warnings.push(`Page ${number} could not be read (${errorMessage(error)}).`);
      }
      const { text, cut } = budget(markdown);
      parts.push({ label: `Page ${number}`, markdown: text, type: "text" });
      if (cut) {
        truncated = true;
        warnings.push(
          `Stopped at page ${number} of ${doc.numPages}, at the ${MAX_TEXT_CHARS.toLocaleString("en-US")}-character cap.`,
        );
        break;
      }
    }
    // Pages dropped by the cap have no part to point at.
    outline = (await outlineOf(doc)).filter((entry) => entry.part < parts.length);
  } finally {
    await task.destroy();
  }

  const parsed: ParsedAttachment = { kind: "pdf", outline, parts, version: 1, warnings, ...(truncated && { truncated }) };
  const scanned = scannedPages(parsed);
  if (scanned.length > 0) {
    parsed.scannedParts = scanned;
    warnings.push(
      scanned.length === 1
        ? `No text layer on page ${scanned[0]}; it is probably a scanned image.`
        : `No text layer on pages ${listPages(scanned)}; they are probably scanned images.`,
    );
  }
  return parsed;
}
