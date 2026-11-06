/**
 * What the evidence ledger indexes from a StockFit response, built once, when the tool runs: a summary
 * line, the subject, the latest filing date, facts for the lines a reader quotes, each naming the
 * filing it came from, and a table the calculator can load. Other tools get a summary and leave the
 * numbers to be read from the text.
 */

import { entityFromArgs, latestDate } from "@/lib/evidence/normalizers/text";
import type { EvidenceFact, EvidenceTable, StructuredDetails } from "@/lib/evidence/types";
import { isRecord } from "@/lib/utils";
import { barDay, isoDay, type JsonObject, suppliers } from "./asof";
import { PRICE_HISTORY_TOOL, STATEMENT_TOOLS } from "./meta";

/** A price series can run to thousands of bars; the ledger indexes the newest slice, the payload keeps all. */
export const MAX_TABLE_ROWS = 200;

/**
 * The lines indexed as facts, under the names EDGAR uses for the same line so the automatic
 * cross-check pairs them. StockFit's `eps` is basic EPS, which `canonicalMetric` would otherwise
 * read as diluted.
 */
export const stockfitFactMetrics: Readonly<Record<string, string>> = {
  revenue: "revenue",
  costOfRevenue: "costOfRevenue",
  grossProfit: "grossProfit",
  operatingIncome: "operatingIncome",
  netIncome: "netIncome",
  eps: "basicEps",
  epsDiluted: "dilutedEps",
  weightedAverageSharesOutstandingDiluted: "dilutedShares",
  ebitda: "ebitda",
  assets: "assets",
  liabilities: "liabilities",
  stockholdersEquity: "equity",
  cash: "cash",
  longTermDebt: "longTermDebt",
  totalDebt: "totalDebt",
  operatingCashFlow: "operatingCashFlow",
  capitalExpenditure: "capex",
  freeCashFlow: "freeCashFlow",
};

const statementTitles: Record<string, string> = {
  financials_income_statement: "income statement",
  financials_balance_sheet: "balance sheet",
  financials_cash_flow_statement: "cash flow statement",
};

export interface Normalized {
  details: StructuredDetails;
  /** Lines to append to the result text, e.g. that only the newest rows were indexed. */
  notes: string[];
}

/** `StockFit filings, $AAPL`: the summary of a response no shape reader knows. */
export function stockfitSummary(toolName: string, args: Record<string, unknown>): StructuredDetails {
  const ticker = entityFromArgs(args)?.ticker;
  return { summary: `StockFit ${toolName}${ticker ? `, $${ticker}` : ""}` };
}

/* ------------------------------------------------------------- statements */

function isPerShare(field: string): boolean {
  return /^eps/i.test(field) || /pershare/i.test(field);
}

function isShareCount(field: string): boolean {
  return /shares/i.test(field) && !isPerShare(field);
}

/**
 * The currency one fact is in. A value the server could not convert stays in its own currency, listed
 * under `fx.unconverted`; with `currency=original` every value is listed there. Undefined when a value
 * was asked for as reported and the response does not say which currency that is.
 */
function factCurrency(row: JsonObject, field: string, requested: string | undefined): string | undefined {
  const fx = isRecord(row.fx) ? row.fx : undefined;
  if (fx && isRecord(fx.unconverted)) {
    for (const [currency, fields] of Object.entries(fx.unconverted)) {
      if (Array.isArray(fields) && fields.includes(field)) return currency;
    }
  }
  // The server answers in USD unless asked otherwise, and adds no `fx` block when nothing was converted.
  const target = typeof fx?.targetCurrency === "string" ? fx.targetCurrency : (requested ?? "USD");
  return target.toLowerCase() !== "original" ? target.toUpperCase() : undefined;
}

function unitOf(row: JsonObject, field: string, requested: string | undefined): string | undefined {
  if (isShareCount(field)) return "shares";
  const currency = factCurrency(row, field, requested);
  if (!currency) return undefined;
  return isPerShare(field) ? `${currency}/share` : currency;
}

function periodTypeOf(toolName: string, row: JsonObject): EvidenceFact["periodType"] {
  if (toolName === "financials_balance_sheet") return "instant";
  const fiscal = String(row.fiscalPeriod ?? "").toUpperCase();
  if (fiscal === "FY") return "annual";
  if (/^Q[1-4]$/.test(fiscal)) return "quarterly";
  return undefined;
}

function statementFacts(toolName: string, rows: JsonObject[], requested: string | undefined): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  for (const row of rows) {
    const period = isoDay(row.period);
    if (!period || !isRecord(row.facts)) continue;
    const supplied = suppliers(row);
    const periodType = periodTypeOf(toolName, row);
    for (const [field, metric] of Object.entries(stockfitFactMetrics)) {
      const value = row.facts[field];
      const unit = unitOf(row, field, requested);
      if (typeof value !== "number" || !Number.isFinite(value) || !unit) continue;
      const ref = supplied.get(field)?.accession;
      facts.push({ metric, period, ...(periodType ? { periodType } : {}), value, unit, ...(ref ? { ref } : {}), end: period });
    }
  }
  return facts;
}

/** Every line of the statement, one row per line and one column per period, `null` for a gap. */
function statementTable(rows: JsonObject[], periods: string[]): EvidenceTable {
  const lines = [...new Set(rows.flatMap((row) => (isRecord(row.facts) ? Object.keys(row.facts) : [])))];
  return {
    columns: ["metric", ...periods],
    rows: lines.map((line) => [
      line,
      ...rows.map((row) => {
        const value = isRecord(row.facts) ? row.facts[line] : undefined;
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      }),
    ]),
    index: "metric",
  };
}

function statementDetails(toolName: string, args: Record<string, unknown>, payload: unknown): Normalized | undefined {
  if (!Array.isArray(payload)) return undefined;
  const rows = payload.filter(isRecord).filter((row) => isoDay(row.period) !== undefined);
  const requested = typeof args.currency === "string" && args.currency.trim() ? args.currency.trim() : undefined;
  const entity = entityFromArgs(args);
  const asked = String(args.period ?? "annual").toLowerCase();
  const basis = asked === "quarter" ? "quarterly" : asked;
  const title = `StockFit ${statementTitles[toolName] ?? toolName}, ${basis}${entity?.ticker ? `, $${entity.ticker}` : ""}`;
  if (rows.length === 0) return { details: { summary: `${title}, no periods`, ...(entity ? { entity } : {}), numbers: [] }, notes: [] };

  const periods = rows.map((row) => isoDay(row.period) as string);
  const filed = latestDate(rows.map((row) => isoDay(row.dateFiled)));
  const latest = latestDate(periods);
  const facts = statementFacts(toolName, rows, requested);
  const currencies = new Set(facts.filter((fact) => fact.unit !== "shares" && !fact.unit.includes("/")).map((fact) => fact.unit));
  const details: StructuredDetails = {
    summary: `${title}, ${rows.length} period${rows.length === 1 ? "" : "s"}${latest ? ` (latest ${latest})` : ""}`,
    ...(entity ? { entity } : {}),
    periods,
    ...(filed ? { asOf: filed, availableAt: filed } : {}),
    ...(currencies.size === 1 ? { currency: [...currencies][0], unit: [...currencies][0] } : {}),
    ...(facts.length ? { facts } : {}),
    table: statementTable(rows, periods),
  };
  return { details, notes: [] };
}

/* ----------------------------------------------------------------- prices */

function priceDetails(args: Record<string, unknown>, payload: unknown): Normalized | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;
  const bars = payload.data
    .map((bar): [string | undefined, number | null] => [
      Array.isArray(bar) ? barDay(bar[0]) : undefined,
      Array.isArray(bar) && typeof bar[1] === "number" && Number.isFinite(bar[1]) ? bar[1] : null,
    ])
    .filter((bar): bar is [string, number | null] => bar[0] !== undefined)
    .sort(([a], [b]) => (a < b ? 1 : -1));
  const symbol = typeof payload.symbol === "string" ? payload.symbol.toUpperCase() : entityFromArgs(args)?.ticker;
  const resolution = typeof payload.resolution === "string" ? payload.resolution : "1d";
  const title = `StockFit ${resolution} closes${symbol ? `, $${symbol}` : ""}`;
  if (bars.length === 0) return { details: { summary: `${title}, no bars`, ...(symbol ? { entity: { ticker: symbol } } : {}), numbers: [] }, notes: [] };

  const [latestDay, latestClose] = bars[0];
  const shown = bars.slice(0, MAX_TABLE_ROWS);
  // Adjusted closes are restated for every later dividend, so they must not meet a raw close in the cross-check.
  const metric = args.adjusted === false ? "close" : "adjustedClose";
  const details: StructuredDetails = {
    summary: `${title}, ${bars.length} bars (latest ${latestDay}${latestClose !== null ? `, ${metric} ${latestClose}` : ""})`,
    ...(symbol ? { entity: { ticker: symbol } } : {}),
    asOf: latestDay,
    unit: "USD",
    currency: "USD",
    facts: latestClose !== null ? [{ metric, period: latestDay, periodType: "instant", value: latestClose, unit: "USD", end: latestDay }] : [],
    table: { columns: ["date", metric], rows: shown, index: "date" },
  };
  const notes = shown.length < bars.length ? [`Evidence table: the newest ${shown.length} of ${bars.length} bars were indexed.`] : [];
  return { details, notes };
}

/* ------------------------------------------------------------ the entries */

/** Everything the ledger takes from one parsed StockFit response. */
export function stockfitDetails(toolName: string, args: Record<string, unknown>, payload: unknown): Normalized {
  const shaped = STATEMENT_TOOLS.has(toolName)
    ? statementDetails(toolName, args, payload)
    : toolName === PRICE_HISTORY_TOOL
      ? priceDetails(args, payload)
      : undefined;
  return shaped ?? { details: stockfitSummary(toolName, args), notes: [] };
}
