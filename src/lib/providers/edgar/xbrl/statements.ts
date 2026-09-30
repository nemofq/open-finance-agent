/**
 * The files under `xbrl/` turn a filer's XBRL `companyfacts` document into compact, as-reported
 * statement tables. Everything there is pure: the network lives in `../client.ts`. The work is
 * split by stage: the tags each metric reads (`metrics.ts`), stock splits and the share basis
 * (`splits.ts`), period series with derived quarters (`series.ts`), computed lines
 * (`measures.ts`), structured statements (this file) and the markdown table (`render.ts`).
 *
 * This file: the statements a filer's facts are shown as, and building one as structured rows:
 * base-unit values with the accession behind each cell.
 */
import { type Ctx, freeCashFlow, grossProfit, margin, revenueGrowth } from "./measures";
import { type CompanyFacts, days, type Format, type MetricName, type Period, reportedCurrency, type StatementId } from "./metrics";
import { buildSeries, type Derivation, type Series } from "./series";
import { detectSplits, type ShareBasis, type ShareSplit } from "./splits";

export const statementTitles: Record<StatementId, string> = {
  income: "Income statement",
  balance: "Balance sheet",
  cashflow: "Cash flow statement",
  key_metrics: "Key metrics",
};

interface Row {
  /**
   * Stable id carried into the evidence ledger, so a fact's metric never drifts from the
   * label shown. Equal to `metric` on reported lines; a fixed id such as `grossMargin` on
   * computed ones.
   */
  id: string;
  label: string;
  format: Format;
  metric?: MetricName;
  /** Used instead of `metric` for lines the filer does not tag, such as free cash flow. */
  compute?: (ctx: Ctx, end: string) => number | undefined;
  /** The input whose filing backs a computed line; revenue when absent. */
  basis?: MetricName;
}

const statements: Record<StatementId, Row[]> = {
  income: [
    { id: "revenue", label: "Revenue", metric: "revenue", format: "money" },
    { id: "costOfRevenue", label: "Cost of revenue", metric: "costOfRevenue", format: "money" },
    { id: "grossProfit", label: "Gross profit", format: "money", compute: grossProfit },
    { id: "operatingIncome", label: "Operating income", metric: "operatingIncome", format: "money" },
    { id: "netIncome", label: "Net income", metric: "netIncome", format: "money" },
    { id: "dilutedEps", label: "Diluted EPS", metric: "dilutedEps", format: "eps" },
    { id: "dilutedShares", label: "Diluted shares", metric: "dilutedShares", format: "shares" },
  ],
  balance: [
    { id: "assets", label: "Total assets", metric: "assets", format: "money" },
    { id: "liabilities", label: "Total liabilities", metric: "liabilities", format: "money" },
    { id: "equity", label: "Shareholders' equity", metric: "equity", format: "money" },
    { id: "cash", label: "Cash and equivalents", metric: "cash", format: "money" },
    { id: "longTermDebt", label: "Long-term debt", metric: "longTermDebt", format: "money" },
  ],
  cashflow: [
    { id: "operatingCashFlow", label: "Operating cash flow", metric: "operatingCashFlow", format: "money" },
    { id: "capex", label: "Capital expenditure", metric: "capex", format: "money" },
    { id: "freeCashFlow", label: "Free cash flow", format: "money", compute: freeCashFlow, basis: "operatingCashFlow" },
  ],
  key_metrics: [
    { id: "revenue", label: "Revenue", metric: "revenue", format: "money" },
    { id: "grossMargin", label: "Gross margin", format: "percent", compute: (ctx, end) => margin(grossProfit(ctx, end), ctx.value("revenue", end)) },
    { id: "operatingMargin", label: "Operating margin", format: "percent", compute: (ctx, end) => margin(ctx.value("operatingIncome", end), ctx.value("revenue", end)) },
    { id: "netMargin", label: "Net margin", format: "percent", compute: (ctx, end) => margin(ctx.value("netIncome", end), ctx.value("revenue", end)) },
    { id: "dilutedEps", label: "Diluted EPS", metric: "dilutedEps", format: "eps" },
    { id: "freeCashFlow", label: "Free cash flow", format: "money", compute: freeCashFlow, basis: "operatingCashFlow" },
    { id: "revenueGrowthYoY", label: "Revenue YoY", format: "percent", compute: revenueGrowth },
  ],
};

/** Each statement's line ids in table order, read from the definitions above so tool text cannot drift from them. */
export const statementLines = Object.fromEntries(
  Object.entries(statements).map(([id, rows]) => [id, rows.map((row) => row.id)]),
) as Record<StatementId, string[]>;

/** "income: revenue, …; balance: …", the catalog tool text shows so every line is discoverable. */
export const statementCatalog = Object.entries(statementLines)
  .map(([id, lines]) => `${id}: ${lines.join(", ")}`)
  .join("; ");

/** One cell of a statement row: the base-unit value, how it is shown, and what backs it. */
export interface StatementCell {
  /** Reported currency, currency per share, shares or percent. Absent when the filer reports nothing. */
  value?: number;
  /** The cell as the markdown table shows it: `1,200.0`, `1.50`, `41.7%` or `—`. */
  formatted: string;
  /** Accession number of the filing the value came from. */
  accession?: string;
  /** How the value's quarter was reconstructed from other facts; absent on reported values. */
  derivation?: Derivation;
}

export interface StatementRow {
  /** Stable id shared with the evidence ledger, e.g. `revenue` or `grossMargin`. */
  metric: string;
  label: string;
  /** Reported currency, currency per share, `shares` or `%`. */
  unit: string;
  cells: StatementCell[];
}

export interface Statement {
  entity: string;
  statement: StatementId;
  period: Period;
  /** Period ends, newest first; also the column labels of the rendered table. */
  columns: string[];
  rows: StatementRow[];
  /** Newest `filed` date among the facts that produced a value: what the data is as of. */
  latestFiled?: string;
  /** The point-in-time cutoff that was applied, when the turn had one. */
  asOf?: string;
  /**
   * Splits per-share and share-count facts were restated for, oldest first: facts filed
   * before each one are on the basis in force at the cutoff (or today, without one).
   */
  shareBasis?: ShareSplit[];
}

/** The unit each format carries, in base units rather than the millions the table shows. */
function unitOf(format: Format, currency: string): string {
  return format === "money" ? currency : format === "eps" ? `${currency}/share` : format === "shares" ? "shares" : "%";
}

function formatValue(value: number, format: Format): string {
  if (format === "eps") return value.toFixed(2);
  if (format === "percent") return `${value.toFixed(1)}%`;
  return (value / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Period ends worth a column, newest first. */
function columnEnds(all: Map<MetricName, Series>): string[] {
  const ends = new Set<string>();
  for (const metric of ["revenue", "netIncome", "operatingIncome", "operatingCashFlow"] as const) {
    for (const end of all.get(metric)?.keys() ?? []) ends.add(end);
  }
  if (ends.size === 0) {
    // A filer with no income-statement tags at all: fall back to balance-sheet dates.
    for (const metric of ["assets", "equity"] as const) {
      for (const end of all.get(metric)?.keys() ?? []) ends.add(end);
    }
  }
  return [...ends].sort((a, b) => b.localeCompare(a));
}

/**
 * One statement as structured rows: the same numbers the markdown table shows, in base
 * units and with the accession behind each cell, so the evidence ledger indexes them
 * exactly instead of parsing the text back.
 */
export function buildStatementData(
  facts: CompanyFacts,
  statement: StatementId,
  period: Period,
  limit = 8,
  options: { asOf?: string } = {},
): Statement {
  const basis: ShareBasis = { splits: detectSplits(facts, options.asOf), asOf: options.asOf };
  const all = buildSeries(facts, period, basis);
  const currency = reportedCurrency(facts);
  const columns = columnEnds(all).slice(0, Math.max(1, limit));
  const entity = facts.entityName || "Unknown filer";
  if (columns.length === 0) {
    return { entity, statement, period, columns: [], rows: [], asOf: options.asOf };
  }

  const ends = [...new Set([...all.values()].flatMap((series) => [...series.keys()]))].sort();
  const ctx: Ctx = {
    point: (metric, end) => all.get(metric)?.get(end),
    value: (metric, end) => all.get(metric)?.get(end)?.val,
    yearAgo: (end) => ends.find((candidate) => days(candidate, end) >= 350 && days(candidate, end) <= 380),
  };

  let latestFiled: string | undefined;
  const restatedFor = new Set<ShareSplit>();
  const rows = statements[statement].map((row): StatementRow => ({
    metric: row.id,
    label: row.label,
    unit: unitOf(row.format, currency),
    cells: columns.map((end): StatementCell => {
      const value = row.metric ? ctx.value(row.metric, end) : row.compute?.(ctx, end);
      if (value === undefined || !Number.isFinite(value)) return { formatted: "—" };
      // A computed line is backed by the filing its inputs came from, and revenue is in all of
      // them except where a cash-flow line names its own basis.
      const point = ctx.point(row.metric ?? row.basis ?? "revenue", end);
      if (point && (latestFiled === undefined || point.filed > latestFiled)) latestFiled = point.filed;
      for (const split of point?.shareSplits ?? []) restatedFor.add(split);
      return {
        value,
        formatted: formatValue(value, row.format),
        accession: point?.accn,
        ...(point?.derivation ? { derivation: point.derivation } : {}),
      };
    }),
  }));

  // Only the splits behind a value the table shows.
  const shareBasis = basis.splits.filter((split) => restatedFor.has(split));
  return {
    entity,
    statement,
    period,
    columns,
    rows,
    latestFiled,
    asOf: options.asOf,
    ...(shareBasis.length ? { shareBasis } : {}),
  };
}
