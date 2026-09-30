/**
 * Alpha Vantage serves several functions as CSV, and the MCP server hands the CSV through as
 * text. Without this, a point-in-time turn would trim the JSON shapes and let a CSV time series
 * past the cutoff untouched, which is how 2026 prices reached a 2024 as-of task.
 */

import { isoDay } from "./asof";

/** Split one CSV row, honouring the double quotes Alpha Vantage puts around company names. */
export function parseCsvRow(row: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (quoted && char === '"' && row[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

/** Header names Alpha Vantage uses for the date a row belongs to, lowercased. */
const DATE_HEADERS = new Set(["timestamp", "date", "time", "reportdate", "reporteddate", "fiscaldateending"]);

export interface CsvBody {
  headerLine: string;
  header: string[];
  /** Parsed data rows; `lines[i]` is the untouched text of `rows[i]`. */
  rows: string[][];
  lines: string[];
  /** Index into `header` of the column that dates a row. */
  dateColumn: number;
}

/**
 * One CSV body with a datable column, or null: JSON, prose and any table we cannot place in
 * time are left exactly as they arrived.
 */
export function parseCsvBody(text: string): CsvBody | null {
  const body = text.trim();
  if (body === "" || body.startsWith("{") || body.startsWith("[") || body.startsWith("<")) return null;

  const [headerLine, ...rest] = body.split(/\r?\n/);
  const header = parseCsvRow(headerLine);
  if (header.length < 2) return null;

  const dateColumn = header.findIndex((name) => DATE_HEADERS.has(name.trim().toLowerCase()));
  if (dateColumn < 0) return null;

  const lines = rest.filter((line) => line.trim() !== "");
  const rows = lines.map(parseCsvRow);
  // A header on its own says nothing about time and has nothing to trim.
  return rows.length > 0 ? { headerLine, header, rows, lines, dateColumn } : null;
}

/** The day a row belongs to, or undefined when its date cell is not a date. */
export function rowDay(body: CsvBody, row: string[]): string | undefined {
  return isoDay(row[body.dateColumn]);
}

export interface CsvTrim {
  rows: string[][];
  lines: string[];
  changed: boolean;
}

/**
 * Drop rows dated after the cutoff. A row whose date cell will not parse is dropped too: these
 * shapes always carry a date, so an unparsable one cannot be shown to predate the cutoff.
 */
export function trimCsvRows(body: CsvBody, asOf: string): CsvTrim {
  const keep = body.rows.map((row) => {
    const day = rowDay(body, row);
    return day !== undefined && day <= asOf;
  });
  const changed = keep.some((kept) => !kept);
  return {
    rows: body.rows.filter((_, index) => keep[index]),
    lines: body.lines.filter((_, index) => keep[index]),
    changed,
  };
}

/** The kept rows as CSV again, with the original header and row text. */
export function csvText(body: CsvBody, lines: string[]): string {
  return [body.headerLine, ...lines].join("\n");
}
