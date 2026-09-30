import { cleanCell, excelCellText, parseTableNumber, readCompleteDelimited, readCompleteWorkbook } from "@/lib/attachments/tables";
import { formatZodIssues } from "@/lib/utils";
import { fieldNames, importPositionSchema } from "./schema";
import type {
  ColumnMapping,
  CostBasisMode,
  FieldName,
  ImportPosition,
  PreviewPosition,
  RawTable,
} from "./types";
import { DEFAULT_PORTFOLIO_CURRENCY } from "./types";

/**
 * Reading a holdings file: CSV, xlsx or a pasted broker table becomes a `RawTable`, its columns are
 * guessed from their headers, and every row is normalised into a `PreviewPosition` the user can
 * correct before it reaches the ledger. Nothing here writes: `commitImport` does that.
 *
 * Tables are read through the complete-table API in `attachments/tables.ts`: a file comes back with
 * every row, or is refused with a `TableTooLarge` that names the limit. An import is a statement of
 * the whole account, so the first N rows of a file must never be taken for all of it.
 */

const aliases: Record<FieldName, string[]> = {
  symbol: ["symbol", "ticker", "security", "cusip", "isin"],
  name: ["name", "description", "security name", "asset", "holding"],
  quantity: ["quantity", "qty", "shares", "units", "position"],
  price: ["price", "last price", "market price", "unit price"],
  marketValue: ["market value", "value", "current value", "mv", "total value"],
  costBasis: ["cost basis", "cost", "book value", "total cost", "average cost", "avg cost"],
};

/** Reading a cell as a number is shared with the attachment parsers; imports keep their own name. */

/** Headers are matched on shape, not spelling: "Market Value" and "market_value" are one column. */
function key(value: string): string {
  return value.toLowerCase().replace(/[\s_()/-]+/g, " ").trim();
}

function columnValue(headers: string[], row: string[], name?: string): string {
  if (!name) return "";
  const index = headers.indexOf(name);
  return index === -1 ? "" : cleanCell(row[index]);
}

export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const field of fieldNames) {
    const match = headers.find((header) => aliases[field].includes(key(header)));
    if (match) mapping[field] = match;
  }
  return mapping;
}

function toTable(rows: string[][], source: RawTable["source"], label: string): RawTable {
  const [headerRow, ...body] = rows;
  if (!headerRow || headerRow.length === 0) throw new Error(`${label} has no header row.`);
  const allRows = rows.map((row) => row.map(cleanCell));
  return { headers: headerRow.map(cleanCell), rows: body.map((row) => row.map(cleanCell)), allRows, source };
}

export function parseCsv(text: string, label = "The CSV file"): RawTable {
  return toTable(readCompleteDelimited(text, { label }), "csv", "CSV");
}

/** A pasted table is tab-separated when it came from a browser or a spreadsheet, comma otherwise. */
export function parsePastedTable(text: string): RawTable {
  const delimiter = text.includes("\t") ? "\t" : ",";
  return toTable(readCompleteDelimited(text, { label: "The pasted table", delimiter }), "paste", "Pasted table");
}

/** Every worksheet is returned: a broker export often keeps holdings and cash on separate sheets. */
export async function parseXlsx(buffer: ArrayBuffer, label = "The workbook"): Promise<RawTable[]> {
  const sheets = await readCompleteWorkbook(buffer, label);
  return sheets.map((sheet) => {
    const values = sheet.rows.map((row) => row.map(excelCellText));
    const [headers = [], ...rows] = values;
    return { headers, rows, allRows: values, source: "xlsx", sheetName: sheet.name } satisfies RawTable;
  });
}

const EXCLUDED = "Excluded by user";

/**
 * One source row per preview row, in source order, so a message can always name the line the user
 * is looking at. A row is never dropped here: it is flagged, and the user excludes it or fixes it.
 */
export function normalizeRows(
  table: RawTable,
  mapping: ColumnMapping,
  costBasisMode: CostBasisMode,
  excludedRows: number[] = [],
): PreviewPosition[] {
  const excluded = new Set(excludedRows);
  return table.rows.map((row, index) => {
    // The header is line 1, so the first body row is line 2 of the file the user opened.
    const rowNumber = index + 2;
    if (excluded.has(rowNumber)) return excludedRow(rowNumber);
    return normalizeRow(table.headers, row, rowNumber, mapping, costBasisMode);
  });
}

function excludedRow(rowNumber: number): PreviewPosition {
  return {
    rowNumber,
    symbol: null,
    name: null,
    quantity: null,
    price: null,
    marketValue: null,
    costBasis: null,
    currency: null,
    assetType: "custom",
    warnings: [EXCLUDED],
    errors: [],
  };
}

function normalizeRow(
  headers: string[],
  row: string[],
  rowNumber: number,
  mapping: ColumnMapping,
  costBasisMode: CostBasisMode,
): PreviewPosition {
  const raw = (field: FieldName): string => columnValue(headers, row, mapping[field]);
  const symbol = raw("symbol").replace(/^\$/, "").toUpperCase() || null;
  const name = raw("name") || symbol;
  const quantity = parseTableNumber(raw("quantity"));
  const price = parseTableNumber(raw("price"));
  const rawValue = parseTableNumber(raw("marketValue"));
  const rawCost = parseTableNumber(raw("costBasis"));
  // Every row is read in the one currency an import takes.
  const currency = DEFAULT_PORTFOLIO_CURRENCY;

  const warnings: string[] = [];
  const errors: string[] = [];

  if (!name) errors.push("Asset name or symbol is required.");
  if (name && quantity === null && rawValue === null) {
    errors.push("Quantity or market value is required; exclude summary rows before confirming.");
  }
  if (!symbol) warnings.push("Ticker not recognized; saved as a custom asset.");
  // A cell that holds something we could not read is an error; an empty cell is not.
  for (const [field, parsed, label] of [
    ["quantity", quantity, "Quantity"],
    ["price", price, "Price"],
    ["marketValue", rawValue, "Market value"],
    ["costBasis", rawCost, "Cost basis"],
  ] as const) {
    if (raw(field) && parsed === null) errors.push(`${label} is not a valid number.`);
  }

  let marketValue = rawValue;
  if (marketValue === null && quantity !== null && price !== null) {
    marketValue = quantity * price;
    warnings.push("Market value calculated from quantity × price.");
  }
  const costBasis =
    rawCost !== null && costBasisMode === "per_unit" && quantity !== null ? rawCost * quantity : rawCost;

  if (!mapping.costBasis && rawCost === null) warnings.push("Cost basis not provided.");
  if (quantity !== null && quantity < 0) {
    warnings.push("Negative quantity: the record is kept, but a short position is not replayed as a holding.");
  }

  return {
    rowNumber,
    symbol,
    name,
    quantity,
    price,
    marketValue,
    costBasis,
    currency,
    assetType: symbol ? "security" : "custom",
    warnings,
    errors,
  };
}

/** The rows of a preview the user can act on: excluded and broken rows are left behind. */
export function acceptedPositions(preview: PreviewPosition[]): ImportPosition[] {
  return preview
    .filter((row) => !row.warnings.includes(EXCLUDED) && row.errors.length === 0 && row.name !== null)
    .map((row) => ({
      rowNumber: row.rowNumber,
      symbol: row.symbol,
      // `name` is non-null past the filter above; the preview type keeps it nullable for bad rows.
      name: row.name ?? "",
      quantity: row.quantity,
      price: row.price,
      marketValue: row.marketValue,
      costBasis: row.costBasis,
      currency: row.currency ?? DEFAULT_PORTFOLIO_CURRENCY,
      assetType: row.assetType,
    }));
}

/** The last gate before the ledger; the browser may have edited the rows since the preview. */
export function validatePositions(positions: ImportPosition[]): void {
  const result = importPositionSchema.array().safeParse(positions);
  if (!result.success) {
    throw new Error(formatZodIssues(result.error, "positions"));
  }
  for (const [index, position] of positions.entries()) {
    const where = position.rowNumber ? `Row ${position.rowNumber}` : `Position ${index + 1}`;
    if (position.quantity === null && position.marketValue === null) {
      throw new Error(`${where} needs quantity or market value.`);
    }
    if (position.assetType === "security" && !position.symbol) {
      throw new Error(`${where} is marked as a security without a symbol.`);
    }
  }
}
