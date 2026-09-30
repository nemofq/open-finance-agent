/**
 * Table reading, owned by attachments and shared with the holdings import: one CSV configuration,
 * one ExcelJS loader, and one idea of what a cell holds. Pure cell conversion — nothing here knows
 * about parts or portfolios; `parse/tabular.ts` and `portfolio/parser.ts` each keep their own
 * shape and their own names for these.
 *
 * Two ways to read. `readDelimited` and `readXlsxSheets` hand back whatever the file holds, and the
 * attachment parser caps that itself, saying so in a warning. `readCompleteDelimited` and
 * `readCompleteWorkbook` are for a caller that must have all of a table or none of it: they refuse
 * a table over the bounds with `TableTooLarge` instead of returning part of it.
 *
 * Node-only: reading a workbook goes through a Buffer. Never import it from browser code.
 */

import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { MAX_DOCUMENT_BYTES, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from "./limits";
import { count, megabytes } from "./wording";
import { inspectZip, ZipTooLarge } from "./zip";

/** A cell once read: a number when it is one, an ISO string for a date, the text, or empty. */
export type TableCell = string | number | null;

/** Characters a spreadsheet puts around a number that are decoration, not digits. */
const DECORATION = /[,$€£¥%\s]/g;
const BLANK = /^(?:[-—–]|na|n\/a|null|none)$/i;
const NUMERIC = /^[+-]?\d+(?:\.\d+)?$/;
/** `007` and `0123` are identifiers the file kept as text; reading them as numbers loses them. */
const PADDED = /^[+-]?0\d/;

/** The delimiters a machine-written table uses. */
const DELIMITERS = [",", ";", "\t", "|"];
/** Enough lines to tell a delimiter apart, few enough that a 20 MB file is still cheap to sniff. */
const SNIFF_LINES = 20;

export function cleanCell(value: unknown): string {
  // A non-breaking space from a web table is whitespace to a human, so it must not survive a trim.
  return String(value ?? "").replace(/ /g, " ").trim();
}

/**
 * A spreadsheet cell as a number, or null when the cell is empty or is not one.
 *
 * Accounting notation is honoured: `(1,234.50)` is negative. Thousands separators, currency signs
 * and a trailing percent sign are stripped, but anything still left over (a stray letter, two dots)
 * makes the cell invalid rather than a silent zero.
 */
export function parseTableNumber(value: string): number | null {
  const input = cleanCell(value);
  if (!input || BLANK.test(input)) return null;
  const parenthesised = /^\(.*\)$/.test(input);
  const digits = input.replace(/^\((.*)\)$/, "$1").replace(DECORATION, "");
  if (!NUMERIC.test(digits)) return null;
  const parsed = Number(parenthesised ? `-${digits.replace(/^[+-]/, "")}` : digits);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A cell may be a formula, a hyperlink or rich text; all we want is what the user sees. */
export function excelCellText(cell: unknown): string {
  if (typeof cell === "object" && cell !== null) {
    const shown = shownValue(cell);
    if (shown !== cell) return cleanCell(shown);
  }
  return cleanCell(cell);
}

/**
 * A cell with its type kept: numbers stay numbers so the calculator can add them up, dates become
 * ISO strings, and a cell that is empty or holds only a blank marker becomes null.
 */
export function tableCell(value: unknown): TableCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return isoDate(value);
  if (typeof value === "object") {
    // `#DIV/0!` says more about the sheet than an empty cell would.
    if ("error" in value) return cleanCell(value.error) || null;
    const shown = shownValue(value);
    return shown === value ? null : tableCell(shown);
  }
  const text = cleanCell(value);
  if (!text) return null;
  return PADDED.test(text) ? text : parseTableNumber(text) ?? text;
}

/** What an ExcelJS cell object displays, or the object itself when it is not one of these. */
function shownValue(cell: object): unknown {
  if ("result" in cell) return cell.result;
  if ("richText" in cell && Array.isArray(cell.richText)) {
    return cell.richText.map((part: { text?: string }) => part.text ?? "").join("");
  }
  if ("text" in cell) return cell.text;
  return cell;
}

/**
 * A day with no clock reading keeps just the day; anything else keeps the instant.
 *
 * Read in UTC, always. A spreadsheet date is a day, not a moment, and every caller hands us one
 * built in UTC for exactly that reason — read it locally and the same file becomes a different day
 * in Shanghai and in New York.
 */
function isoDate(value: Date): string {
  const iso = value.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}

/**
 * Which character separates the fields: the one that splits the first lines into the same number of
 * fields every time, counting only what falls outside quotes. A semicolon export from a European
 * locale and a tab-separated paste both land here.
 */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, SNIFF_LINES);
  let best = ",";
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    // A delimiter that gives every line the same width is the delimiter; the rest are text.
    const score = counts.every((count) => count === first) ? first * 2 : first;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === delimiter) count++;
  }
  return count;
}

/**
 * Delimited text as rows. Ragged lines are kept as they are: a holdings file that ends with a
 * total line, or an export with a trailing empty column, is still a table worth showing.
 */
export function readDelimited(
  text: string,
  options: { delimiter?: string; relaxQuotes?: boolean } = {},
): string[][] {
  return parse(text, {
    bom: true,
    delimiter: options.delimiter ?? ",",
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: options.relaxQuotes ?? false,
  }) as string[][];
}

/** One worksheet, with its cells as ExcelJS handed them over. */
export interface XlsxSheet {
  name: string;
  hidden: boolean;
  rows: unknown[][];
}

/** Every worksheet is returned: a broker export often keeps holdings and cash on separate sheets. */
export async function readXlsxSheets(data: ArrayBuffer | Uint8Array): Promise<XlsxSheet[]> {
  const workbook = new ExcelJS.Workbook();
  const bytes = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data)) as unknown as Parameters<
    typeof workbook.xlsx.load
  >[0];
  await workbook.xlsx.load(bytes);
  return workbook.worksheets.map((sheet) => {
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      // `row.values` is 1-based, so the leading hole is dropped; a hole inside it is an empty cell.
      const cells = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(Array.from(cells));
    });
    return { name: sheet.name, hidden: sheet.state !== "visible", rows };
  });
}

/* ------------------------------------------------------ complete tables */

/**
 * The bounds a table read whole must fit: the file's bytes, the data rows under its first row, and
 * the columns of its widest row. The same numbers the attachment parser caps a table at.
 */
export interface TableBounds {
  bytes: number;
  rows: number;
  columns: number;
}

const COMPLETE_TABLE_BOUNDS: TableBounds = {
  bytes: MAX_DOCUMENT_BYTES,
  rows: MAX_TABLE_ROWS,
  columns: MAX_TABLE_COLUMNS,
};

/**
 * A table too large to read whole. It is refused rather than cut: a caller that commits what it
 * reads (the holdings import) must never act on the first N rows of a file as if they were all of
 * it. The message names the limit and what to do about it, so a route can hand it straight back.
 */
export class TableTooLarge extends Error {
  // Plain fields, not parameter properties: the parse worker runs this file as strip-only TypeScript.
  readonly limit: keyof TableBounds | ZipTooLarge["limit"];
  readonly actual: number;
  readonly max: number;

  constructor(limit: keyof TableBounds | ZipTooLarge["limit"], actual: number, max: number, message: string) {
    super(message);
    this.name = "TableTooLarge";
    this.limit = limit;
    this.actual = actual;
    this.max = max;
  }
}

/** Refuse a file by its size before it is read, so an oversized upload is never parsed. */
export function checkTableBytes(bytes: number, label: string, bounds: TableBounds = COMPLETE_TABLE_BOUNDS): void {
  if (bytes <= bounds.bytes) return;
  throw new TableTooLarge(
    "bytes",
    bytes,
    bounds.bytes,
    `${label} is larger than the ${megabytes(bounds.bytes)} MB limit for reading a table whole. Nothing was imported: split it into smaller files and import each one.`,
  );
}

function checkTableShape(rows: unknown[][], label: string, bounds: TableBounds): void {
  const body = Math.max(rows.length - 1, 0);
  if (body > bounds.rows) {
    throw new TableTooLarge(
      "rows",
      body,
      bounds.rows,
      `${label} has ${count(body)} rows, over the ${count(bounds.rows)}-row limit for reading a table whole. Nothing was imported: split it into files of at most ${count(bounds.rows)} rows and import each one.`,
    );
  }
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  if (width > bounds.columns) {
    throw new TableTooLarge(
      "columns",
      width,
      bounds.columns,
      `${label} has ${count(width)} columns, over the ${count(bounds.columns)}-column limit for reading a table whole. Nothing was imported: remove the columns you do not need and import it again.`,
    );
  }
}

/** Delimited text as every one of its rows, or `TableTooLarge`; never a prefix of them. */
export function readCompleteDelimited(
  text: string,
  options: { label: string; delimiter?: string; relaxQuotes?: boolean },
  bounds: TableBounds = COMPLETE_TABLE_BOUNDS,
): string[][] {
  checkTableBytes(Buffer.byteLength(text), options.label, bounds);
  const rows = readDelimited(text, options);
  checkTableShape(rows, options.label, bounds);
  return rows;
}

/**
 * Every worksheet with every one of its rows, or `TableTooLarge` naming the sheet that is too big.
 *
 * This runs on the request thread, with no worker heap limit behind it, so the zip caps the parse
 * worker applies are checked from the central directory before ExcelJS inflates anything.
 */
export async function readCompleteWorkbook(
  data: ArrayBuffer | Uint8Array,
  label: string,
  bounds: TableBounds = COMPLETE_TABLE_BOUNDS,
): Promise<XlsxSheet[]> {
  checkTableBytes(data.byteLength, label, bounds);
  await checkWorkbookZip(data instanceof Uint8Array ? data : new Uint8Array(data), label);
  const sheets = await readXlsxSheets(data);
  // A label opens a message, so a generic one is capitalised ("The workbook"); inside this one it is not.
  const within = label.replace(/^The (?=[a-z])/, "the ");
  for (const sheet of sheets) checkTableShape(sheet.rows, `Sheet "${sheet.name}" of ${within}`, bounds);
  return sheets;
}

/** The shared zip caps, refused as a `TableTooLarge` so a route answers them like the other bounds. */
async function checkWorkbookZip(bytes: Uint8Array, label: string): Promise<void> {
  try {
    await inspectZip(bytes, label);
  } catch (error) {
    if (!(error instanceof ZipTooLarge)) throw error;
    const what =
      error.limit === "entries"
        ? `holds ${count(error.actual)} zip entries, over the ${count(error.max)}-entry limit`
        : `unpacks to more than the ${megabytes(error.max)} MB limit`;
    throw new TableTooLarge(
      error.limit,
      error.actual,
      error.max,
      `${label} ${what} for reading a workbook. Nothing was imported: save the sheet you need as a CSV file and import that.`,
    );
  }
}
