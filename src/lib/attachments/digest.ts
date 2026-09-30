/**
 * What an attachment looks like when it does not fit, and what a table always looks like.
 * Shared by `hydrate.ts`, which writes one of these into the turn, and by the
 * `read_attachment` tool, which writes the same shapes when it is asked for a part.
 *
 * Prose is quoted; a table never is. The model computes on tables through the calculator, so what
 * it gets is the schema, the first rows and the evidence id to pass along.
 */

import type { AttachmentCell, AttachmentTablePart, ParsedAttachment, StoredAttachment } from "./types";

/** How much of a document's prose a digest quotes. */
const HEAD_CHARS = 1_500;

/** Rows shown under a table's schema in a digest, and by `read_attachment` on a part. */
const DIGEST_ROWS = 10;
export const PART_ROWS = 50;

/** A long document's outline is itself long; past this the list stops helping. */
const MAX_OUTLINE = 40;

/** Cells read to decide what a column holds. */
const TYPED_ROWS = 50;

/** The evidence id a table part was registered under, when it has one. */
export type TableIds = (part: number) => string | undefined;

/* ---------------------------------------------------------------- labelling */

const PLURALS: Record<string, string> = { page: "pages", slide: "slides", section: "sections", sheet: "sheets" };

/**
 * How many parts there are, in the document's own words: "12 pages", "8 slides", "3 sheets".
 * The noun comes from the parts themselves — a parser labels a pdf page "Page 12" and a slide
 * "Slide 3" — because `kind` cannot tell a deck from a memo.
 */
export function partsLabel(parsed: ParsedAttachment): string {
  const count = parsed.parts.length;
  const noun = nounOf(parsed);
  return `${count.toLocaleString("en-US")} ${count === 1 ? noun : PLURALS[noun]}`;
}

function nounOf(parsed: ParsedAttachment): string {
  if (parsed.kind === "table" || parsed.parts.every((part) => part.type === "table")) return "sheet";
  const first = /^([A-Za-z]+) \d+$/.exec(parsed.parts[0]?.label ?? "")?.[1].toLowerCase();
  return first && Object.hasOwn(PLURALS, first) ? first : "section";
}

/* ------------------------------------------------------------------ tables */

/** What a column holds, read off the rows rather than declared by the file. */
export type ColumnType = "number" | "date" | "text" | "empty";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;

export function columnType(rows: AttachmentCell[][], index: number): ColumnType {
  let numbers = 0;
  let dates = 0;
  let filled = 0;
  for (const row of rows.slice(0, TYPED_ROWS)) {
    const cell = row[index];
    if (cell === null || cell === undefined || cell === "") continue;
    filled += 1;
    if (typeof cell === "number") numbers += 1;
    else if (ISO_DATE.test(cell)) dates += 1;
  }
  if (filled === 0) return "empty";
  if (numbers === filled) return "number";
  if (dates === filled) return "date";
  return "text";
}

/** `date (date), ticker (text), shares (number)` — the schema line under a table's heading. */
export function columnsLine(table: AttachmentTablePart): string {
  return table.columns.map((name, index) => `${name || `column ${index + 1}`} (${columnType(table.rows, index)})`).join(", ");
}

/** One cell, safe to drop into a GFM table row. */
export function markdownCell(value: AttachmentCell | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** The first `count` rows as a GFM table, and a line saying how many there are when that is not all. */
export function rowsTable(table: AttachmentTablePart, count = DIGEST_ROWS): string[] {
  const shown = table.rows.slice(0, count);
  return [
    `| ${table.columns.map(markdownCell).join(" | ")} |`,
    `| ${table.columns.map(() => "---").join(" | ")} |`,
    ...shown.map((row) => `| ${table.columns.map((_, index) => markdownCell(row[index])).join(" | ")} |`),
    ...(table.totalRows > shown.length ? ["", `_First ${shown.length} of ${table.totalRows.toLocaleString("en-US")} rows._`] : []),
  ];
}

/**
 * A table as the model may have it: its name, its size, its columns with the types they hold, a
 * first look at the rows, and the id that loads the whole thing into the calculator.
 */
export function tableDigest(table: AttachmentTablePart, evidenceId?: string, rows = DIGEST_ROWS): string {
  return [
    `### ${table.label}`,
    "",
    `${table.totalRows.toLocaleString("en-US")} rows × ${table.columns.length} columns.`,
    `Columns: ${columnsLine(table)}`,
    ...(evidenceId ? [`Loaded as evidence ${evidenceId}. Pass it to financial_calculator.`] : []),
    "",
    ...rowsTable(table, rows),
  ].join("\n");
}

/* -------------------------------------------------------------- documents */

/** The headings in reading order, as an indented list. */
export function outlineLines(parsed: ParsedAttachment): string[] {
  const headings = parsed.outline.slice(0, MAX_OUTLINE);
  if (headings.length === 0) return [];
  const lines = headings.map(({ level, title }) => `${"  ".repeat(Math.max(0, level - 1))}- ${title}`);
  if (parsed.outline.length > headings.length) lines.push(`  …${parsed.outline.length - headings.length} further headings`);
  return ["Outline:", ...lines];
}

/** Every text part run together, which is what a query is matched against and what a head quotes. */
export function proseOf(parsed: ParsedAttachment): string {
  return parsed.parts
    .flatMap((part) => (part.type === "text" && part.markdown.trim() ? [part.markdown.trim()] : []))
    .join("\n\n");
}

/** Pages a pdf parser found no text layer on; the model must not be told they were empty. */
function scannedNote(stored: StoredAttachment): string[] {
  const pages = stored.scannedParts ?? [];
  if (pages.length === 0) return [];
  const listed = pages.slice(0, 20).join(", ");
  const rest = pages.length > 20 ? `, and ${pages.length - 20} more` : "";
  return [
    `Pages with no text layer (scanned images, not read): ${listed}${rest}. Anything on them is not in this text.`,
  ];
}

function truncatedNote(stored: StoredAttachment): string[] {
  return stored.truncated ? ["The file was larger than this reader's limits, so the end of it was not read."] : [];
}

/**
 * Every part in order: prose in full, and each table as `table` writes it. A document that is all
 * one text part gets no heading: its label is "Document", and an `## Document` above the file's own
 * `# Title` would invert every heading level below it.
 */
export function partsText(parsed: ParsedAttachment, table: (part: AttachmentTablePart, index: number) => string): string {
  const lone = parsed.parts.length === 1 && parsed.parts[0].type === "text";
  return parsed.parts
    .map((part, index) => {
      if (part.type === "table") return table(part, index);
      return (part.label && !lone ? `## ${part.label}\n\n` : "") + part.markdown.trim();
    })
    .join("\n\n")
    .trim();
}

/** The whole document: prose in full, each table as its schema and first rows. */
export function fullText(parsed: ParsedAttachment, stored: StoredAttachment, ids: TableIds = () => undefined): string {
  const body = partsText(parsed, (part, index) => tableDigest(part, ids(index)));
  return [...scannedNote(stored), ...truncatedNote(stored), body].join("\n\n").trim();
}

/**
 * The document when it does not fit: what is in it, the top of it, and how to read the rest.
 * Tables keep their full digest either way — that is all the model ever gets of them.
 */
export function digestOf(parsed: ParsedAttachment, stored: StoredAttachment, ids: TableIds = () => undefined): string {
  const prose = proseOf(parsed);
  const head = prose.length > HEAD_CHARS ? `${prose.slice(0, HEAD_CHARS).trimEnd()}…` : prose;
  const tables = parsed.parts.flatMap((part, index) => (part.type === "table" ? [tableDigest(part, ids(index))] : []));
  const sections = [
    `${partsLabel(parsed)}${prose ? `, about ${approxTokens(stored.tokens)} tokens of text` : ""}.`,
    ...scannedNote(stored),
    ...truncatedNote(stored),
    ...(parsed.outline.length ? [outlineLines(parsed).join("\n")] : []),
    ...(head ? [`Beginning of the text:\n\n${head}`] : []),
    ...tables,
  ];
  if (prose.length > head.length) {
    sections.push("Use read_attachment to read the rest: pass a query to find the passages you need, or a part to read one page.");
  }
  return sections.join("\n\n");
}

/** `8k`, `450`: a size the model can reason about without pretending to precision. */
export function approxTokens(tokens: number): string {
  return tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : String(tokens);
}
