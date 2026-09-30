import { parseNumber, todayIsoDate } from "@/components/shared/format";
import { postForm, postJson } from "@/components/shared/http-client";
import {
  DEFAULT_PORTFOLIO_CURRENCY,
  type ColumnMapping,
  type CostBasisMode,
  type ImportPosition,
  type PreviewPosition,
  type RawTable,
} from "@/lib/portfolio/types";
import { randomId } from "@/lib/utils";

/** State machine transitions for the holdings import workflow. */

export type TableResponse = RawTable & { mapping: ColumnMapping };
export type EditableField = "symbol" | "name" | "quantity" | "price" | "marketValue" | "costBasis";
type NumericField = Exclude<EditableField, "symbol" | "name">;

/** Unparsed string values for an editable row during user review. */
export interface DraftRow {
  symbol: string;
  name: string;
  quantity: string;
  price: string;
  marketValue: string;
  costBasis: string;
  currency: string;
}

/**
 * The columns a mapping can fill and the review can correct, in the order both steps show them.
 * Currency is neither: v1 imports every row in USD, shown only in the preview.
 */
export const editFields: EditableField[] = ["symbol", "name", "quantity", "price", "marketValue", "costBasis"];
const numericFields: NumericField[] = ["quantity", "price", "marketValue", "costBasis"];
/** One name per field for both steps. "Cost basis" holds either a total or a per-unit cost, as the mapping says. */
export const fieldLabels: Record<EditableField, string> = {
  symbol: "Ticker",
  name: "Asset name",
  quantity: "Quantity",
  price: "Unit price",
  marketValue: "Market value",
  costBasis: "Cost basis",
};

export interface ImportState {
  accountId: string;
  /** Every worksheet the source produced, and the one being mapped. */
  tables: TableResponse[];
  table: TableResponse | null;
  headerIndex: number;
  mapping: ColumnMapping;
  costBasisMode: CostBasisMode;
  /** The corrected rows; non-empty once a preview has come back. */
  rows: DraftRow[];
  previewRows: PreviewPosition[];
  previewErrors: string[];
  /** Cells that did not read as numbers at the last confirm. */
  draftErrors: string[];
  excludedRows: number[];
  /** Idempotency key for committing reviewed rows. */
  commitKey: string | null;
  busy: boolean;
  status: string;
  isError: boolean;
}

export function initialImport(accountId: string): ImportState {
  return {
    accountId,
    tables: [],
    table: null,
    headerIndex: 0,
    mapping: {},
    costBasisMode: "total",
    rows: [],
    previewRows: [],
    previewErrors: [],
    draftErrors: [],
    excludedRows: [],
    commitKey: null,
    busy: false,
    status: "",
    isError: false,
  };
}

/** Source rows the preview flagged; each can be excluded before previewing again. */
export function flaggedRows(state: ImportState): PreviewPosition[] {
  return state.previewRows.filter((row) => row.errors.length > 0);
}

export function canCommit(state: ImportState): boolean {
  return state.accountId !== "" && state.previewErrors.length === 0 && state.rows.length > 0;
}

/** Everything downstream of the source goes: tables, mapping, review. */
function clearDraft(state: ImportState): ImportState {
  return {
    ...state,
    tables: [],
    table: null,
    headerIndex: 0,
    mapping: {},
    rows: [],
    previewRows: [],
    previewErrors: [],
    draftErrors: [],
    excludedRows: [],
    commitKey: null,
  };
}

/** Switching the worksheet or the header row invalidates the mapping and everything downstream. */
function resetReview(state: ImportState): ImportState {
  return { ...state, rows: [], previewRows: [], previewErrors: [], draftErrors: [], excludedRows: [], commitKey: null };
}

/** A request has started: the controls wait, and the last message goes. */
export function started(state: ImportState): ImportState {
  return { ...state, busy: true, status: "", isError: false };
}

export function failed(state: ImportState, message: string): ImportState {
  return { ...state, busy: false, isError: true, status: message };
}

/** A different account starts the import over; its draft belonged to the old one. */
export function chooseAccount(state: ImportState, accountId: string): ImportState {
  return { ...clearDraft(state), accountId };
}

/** The source parsed; the first worksheet is mapped with the server's guess. */
export function loaded(state: ImportState, tables: TableResponse[]): ImportState {
  const first = tables[0];
  if (!first) return failed(state, "No worksheet or rows found.");
  return {
    ...clearDraft(state),
    tables,
    table: first,
    mapping: first.mapping,
    busy: false,
    status: `Loaded ${first.rows.length} rows. Review the mapping, then generate a preview.`,
  };
}

export function chooseSheet(state: ImportState, sheetName: string): ImportState {
  const next = state.tables.find((item) => item.sheetName === sheetName);
  if (!next) return state;
  return resetReview({ ...state, table: next, headerIndex: 0, mapping: next.mapping });
}

/** Point at the real header row of a file that starts with a title; the mapping starts empty. */
export function chooseHeaderRow(state: ImportState, index: number): ImportState {
  const table = state.table;
  if (!table) return state;
  const allRows = table.allRows ?? [];
  return resetReview({
    ...state,
    headerIndex: index,
    table: { ...table, headers: allRows[index] ?? [], rows: allRows.slice(index + 1), mapping: {} },
    mapping: {},
  });
}

export function mapColumn(state: ImportState, field: keyof ColumnMapping, header: string): ImportState {
  return { ...state, mapping: { ...state.mapping, [field]: header || undefined } };
}

export function setCostBasisMode(state: ImportState, costBasisMode: CostBasisMode): ImportState {
  return { ...state, costBasisMode };
}

export function mappingSuggested(state: ImportState, mapping: ColumnMapping): ImportState {
  return { ...state, busy: false, mapping, status: "Mapping suggestions loaded. Check them before previewing." };
}

/** A preview request has started; the cell errors of the last confirm no longer apply. */
export function previewing(state: ImportState): ImportState {
  return { ...started(state), draftErrors: [] };
}

export function excludeRow(state: ImportState, rowNumber: number, excluded: boolean): ImportState {
  return {
    ...state,
    excludedRows: excluded
      ? [...state.excludedRows, rowNumber]
      : state.excludedRows.filter((value) => value !== rowNumber),
  };
}

function numberText(value: number | null): string {
  return value === null ? "" : String(value);
}

function draftFromImport(position: ImportPosition): DraftRow {
  return {
    symbol: position.symbol ?? "",
    name: position.name,
    quantity: numberText(position.quantity),
    price: numberText(position.price),
    marketValue: numberText(position.marketValue),
    costBasis: numberText(position.costBasis),
    currency: position.currency,
  };
}

export interface PreviewResponse {
  positions: ImportPosition[];
  preview: PreviewPosition[];
  errors?: string[];
}

/**
 * The server's preview: the accepted rows become editable drafts, the rest are flagged. A preview is
 * a new set of rows to commit, so it gets a new key.
 */
export function previewed(state: ImportState, body: PreviewResponse, commitKey: string = randomId()): ImportState {
  const errors = body.errors ?? [];
  return {
    ...state,
    commitKey,
    busy: false,
    previewRows: body.preview,
    rows: body.positions.map(draftFromImport),
    previewErrors: errors,
    status: errors.length ? "Fix or exclude the flagged rows, then preview again." : `${body.positions.length} positions ready for review.`,
    isError: errors.length > 0,
  };
}

/**
 * Edits one cell in place: rows keep their position, so the input being typed in is never remounted.
 * Edited rows are a different import, so they get a new key: the old one would return the earlier batch.
 */
export function editCell(state: ImportState, index: number, field: EditableField, value: string, commitKey: string = randomId()): ImportState {
  return { ...state, commitKey, rows: state.rows.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)) };
}

export function removeRow(state: ImportState, index: number, commitKey: string = randomId()): ImportState {
  return { ...state, commitKey, rows: state.rows.filter((_, itemIndex) => itemIndex !== index) };
}

/** The rows the user sees, as the ledger needs them, or the reasons they cannot be sent yet. */
export function toImportPositions(rows: DraftRow[]): { positions: ImportPosition[]; errors: string[] } {
  const positions: ImportPosition[] = [];
  const errors: string[] = [];

  for (const [index, row] of rows.entries()) {
    const where = `Row ${index + 1}`;
    const symbol = row.symbol.trim();
    const name = row.name.trim() || symbol;
    const values: Record<NumericField, number | null> = { quantity: null, price: null, marketValue: null, costBasis: null };
    let numeric = true;

    for (const field of numericFields) {
      // An empty cell is a value the file did not state; anything else has to read as a number.
      const text = row[field].trim();
      if (text === "") continue;
      const value = parseNumber(text);
      if (value !== undefined) values[field] = value;
      else {
        errors.push(`${where}: ${fieldLabels[field]} is not a number ("${text}").`);
        numeric = false;
      }
    }

    if (!name) { errors.push(`${where} needs a ticker or an asset name.`); continue; }
    if (!numeric) continue;
    if (values.quantity === null && values.marketValue === null) { errors.push(`${where} needs a quantity or a market value.`); continue; }

    positions.push({
      symbol: symbol || null,
      name,
      quantity: values.quantity,
      price: values.price,
      marketValue: values.marketValue,
      costBasis: values.costBasis,
      currency: row.currency.trim().toUpperCase() || DEFAULT_PORTFOLIO_CURRENCY,
      assetType: symbol ? "security" : "custom",
    });
  }

  return { positions, errors };
}

/**
 * Confirm: the corrected rows, ready to send, or the state that says why they are not. Nothing is
 * sent with a cell that is not a number, a preview error outstanding, or no account.
 */
export function confirm(state: ImportState): { ready: ImportPosition[]; state: ImportState } | { ready: null; state: ImportState } {
  const { positions, errors } = toImportPositions(state.rows);
  const checked = { ...state, draftErrors: errors };
  if (!state.accountId || state.previewErrors.length > 0 || errors.length > 0) {
    return {
      ready: null,
      state: {
        ...checked,
        isError: true,
        status: errors.length > 0 ? "Correct the cells listed below, then confirm again." : "Choose an account and resolve all preview errors before confirming.",
      },
    };
  }
  return { ready: positions, state: checked };
}

/** Committed: the draft is spent. */
export function committed(state: ImportState): ImportState {
  return { ...clearDraft(state), busy: false };
}

/* ---------------------------------------------------------------- requests */

/** Parse a file (`file`) or a pasted table (`text`) into worksheets with a guessed mapping. */
export async function parseSource(input: FormData): Promise<TableResponse[]> {
  const body = await postForm<{ tables: TableResponse[] }>("/api/portfolio/parse", input);
  return body.tables;
}

export function requestPreview(state: ImportState): Promise<PreviewResponse> {
  const { table, mapping, costBasisMode, excludedRows } = state;
  return postJson<PreviewResponse>("/api/portfolio/preview", { table, mapping, costBasisMode, excludedRows });
}

export async function requestMapping(table: TableResponse): Promise<ColumnMapping> {
  const body = await postJson<{ mapping: ColumnMapping }>("/api/portfolio/assist-mapping", {
    headers: table.headers,
    samples: table.rows.slice(0, 3),
  });
  return body.mapping;
}

/**
 * Record the import under the state's `commitKey`. The key makes a request the server has already
 * applied a no-op, so a response lost on the way back cannot record the same attempt twice.
 */
export async function commitPositions(state: ImportState, positions: ImportPosition[]): Promise<void> {
  const idempotencyKey = state.commitKey;
  if (!idempotencyKey) throw new Error("Preview the holdings before recording the import.");
  await postJson<unknown>(`/api/portfolio/commit?today=${todayIsoDate()}`, {
    accountId: state.accountId,
    positions,
    source: state.table?.source ?? "manual",
    idempotencyKey,
  });
}
