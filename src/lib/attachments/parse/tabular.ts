/**
 * Spreadsheets and delimited text: csv and xlsx become one `table` part per file or per worksheet.
 * Cells keep their type — numbers stay numbers, dates become ISO strings — so the calculator can
 * load the part as a DataFrame and the model never has to read rows to add them up.
 *
 * The format is decided by what the bytes are, not by the name: a workbook saved with a `.csv`
 * extension is read as a workbook, and delimited text saved as `.xlsx` as delimited text. The old
 * binary `.xls` is refused before it gets here (`formats.ts`), and the html table or XML that an
 * "Excel" export sometimes turns out to be is refused below with the same fix: save it as `.xlsx`.
 *
 * Every cap in `limits.ts` is applied by keeping fewer rows and saying so in a warning. A file that
 * is too big is still worth reading, just not to the last row; only a file we cannot read at all
 * throws.
 */

import type JSZip from "jszip";
import {
  cleanCell,
  readDelimited,
  readXlsxSheets,
  sniffDelimiter,
  tableCell,
  type XlsxSheet,
} from "../tables";
import { MAX_TABLE_BYTES, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from "../limits";
import { hasSignature, ZIP } from "../signatures";
import { inspectZip, ZipTooLarge } from "../zip";
import type {
  AttachmentCell,
  AttachmentOutlineEntry,
  AttachmentTablePart,
  ParsedAttachment,
} from "../types";
import { count, errorMessage, megabytes } from "../wording";
import { decodeText } from "./text";

/** A worksheet, or the single sheet a csv file amounts to, before the caps are applied. */
interface Sheet {
  label: string;
  rows: AttachmentCell[][];
}

/** Plain bytes that open with markup are a web page or XML export, which no reader here takes. */
const MARKUP = /^\s*<(?:!doctype|\?xml|html|table|meta|body|workbook)\b/i;

export async function parse(bytes: Uint8Array, name: string): Promise<ParsedAttachment> {
  const warnings: string[] = [];
  const parts: AttachmentTablePart[] = [];
  const outline: AttachmentOutlineEntry[] = [];
  const empty: string[] = [];

  for (const sheet of await readSheets(bytes, name, warnings)) {
    const part = toPart(sheet, warnings);
    if (!part) {
      empty.push(sheet.label);
      continue;
    }
    outline.push({ part: parts.length, level: 1, title: part.label });
    parts.push(part);
  }

  if (parts.length === 0) warnings.push(`${name} has no rows.`);
  else if (empty.length > 0) warnings.push(`Empty sheets were skipped: ${empty.join(", ")}.`);
  return { version: 1, kind: "table", parts, outline, warnings };
}

async function readSheets(bytes: Uint8Array, name: string, warnings: string[]): Promise<Sheet[]> {
  if (hasSignature(bytes, ZIP)) return await readXlsx(bytes, name);
  const decoded = decodeText(bytes);
  warnings.push(...decoded.warnings);
  const { text } = decoded;
  // Read as delimited text, a page of markup would come back as a table of tags.
  if (MARKUP.test(text)) {
    throw new Error(`${name} is a web page or XML file, not a spreadsheet. Open it in Excel, save it as .xlsx or .csv and attach it again.`);
  }
  return [readCsv(text, name)];
}

/* ------------------------------------------------------------------ csv */

function readCsv(text: string, name: string): Sheet {
  try {
    const rows = readDelimited(text, { delimiter: sniffDelimiter(text), relaxQuotes: true });
    return { label: "Sheet", rows: rows.map((row) => row.map(tableCell)) };
  } catch (error) {
    throw new Error(`${name} could not be read as delimited text: ${errorMessage(error)}`);
  }
}

/* ----------------------------------------------------------------- xlsx */

async function readXlsx(bytes: Uint8Array, name: string): Promise<Sheet[]> {
  await checkZip(bytes, name);
  let sheets: XlsxSheet[];
  try {
    sheets = await readXlsxSheets(bytes);
  } catch (error) {
    throw new Error(`${name} could not be read as a workbook: ${errorMessage(error)}`);
  }
  return sheets.map((sheet) => ({
    label: sheet.hidden ? `${sheet.name} (hidden)` : sheet.name,
    rows: sheet.rows.map((row) => row.map(tableCell)),
  }));
}

/** The shared zip caps (`../zip.ts`), then the one part a workbook cannot do without. */
async function checkZip(bytes: Uint8Array, name: string): Promise<void> {
  let zip: JSZip;
  try {
    zip = await inspectZip(bytes, name);
  } catch (error) {
    if (error instanceof ZipTooLarge) throw error;
    throw new Error(`${name} could not be read as a workbook: ${errorMessage(error)}`);
  }
  // ExcelJS reads an archive without a workbook part as a workbook with no sheets, which would
  // reach the user as "no rows" instead of "this is not a spreadsheet".
  if (!zip.file("xl/workbook.xml")) {
    throw new Error(`${name} could not be read as a workbook: the archive holds no workbook part.`);
  }
}

/* ----------------------------------------------------------------- caps */

/** The first row names the columns; everything under it is data, padded to one width. */
function toPart(sheet: Sheet, warnings: string[]): AttachmentTablePart | null {
  const [header, ...body] = sheet.rows;
  if (!header) return null;

  let width = header.length;
  for (const row of body) if (row.length > width) width = row.length;
  if (width > MAX_TABLE_COLUMNS) {
    warnings.push(`${sheet.label} has ${count(width)} columns; only the first ${count(MAX_TABLE_COLUMNS)} were kept.`);
    width = MAX_TABLE_COLUMNS;
  }
  if (width === 0) return null;

  const part: AttachmentTablePart = {
    type: "table",
    label: sheet.label,
    columns: namedColumns(header, width),
    rows: [],
    totalRows: body.length,
  };
  // The serialised cap is on the part as it will be written and passed to the sandbox, so what the
  // label and the columns already cost comes off the budget before the first row does.
  let budget = MAX_TABLE_BYTES - Buffer.byteLength(JSON.stringify(part));
  for (const row of body) {
    if (part.rows.length >= MAX_TABLE_ROWS) {
      warnings.push(`${sheet.label} has ${count(body.length)} rows; only the first ${count(MAX_TABLE_ROWS)} were kept.`);
      break;
    }
    const cells = Array.from({ length: width }, (_, index) => row[index] ?? null);
    budget -= Buffer.byteLength(JSON.stringify(cells)) + 1;
    if (budget < 0) {
      warnings.push(
        `${sheet.label} was cut to ${count(part.rows.length)} of ${count(body.length)} rows` +
          ` to stay under ${megabytes(MAX_TABLE_BYTES)} MB.`,
      );
      break;
    }
    part.rows.push(cells);
  }
  return part;
}

/** Every column has a name the model can quote: a blank or repeated header becomes "Column N". */
function namedColumns(header: AttachmentCell[], width: number): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < width; index++) {
    const title = cleanCell(header[index]);
    const name = title && !seen.has(title) ? title : `Column ${index + 1}`;
    seen.add(name);
    columns.push(name);
  }
  return columns;
}
