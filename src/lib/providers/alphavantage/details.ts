/**
 * What the evidence ledger indexes from an Alpha Vantage response, built once, when the tool runs:
 * a summary line, the ticker, the latest date the response contains, facts for the figures a reader
 * quotes, and a table the calculator can load. Every allowlisted function answers in a known JSON
 * shape; anything else gets a summary and leaves the numbers to be read from the text.
 */

import { canonicalMetric } from "@/lib/evidence/metrics";
import { entityFromArgs, extractNumbers, latestDate, toIsoDate } from "@/lib/evidence/normalizers/text";
import type { EvidenceEntity, EvidenceFact, EvidenceTable, StructuredDetails } from "@/lib/evidence/types";
import { isRecord } from "@/lib/utils";
import { type CsvBody, rowDay as csvRowDay } from "./csv";
import {
  isDateKeyedObject,
  isoDay,
  type JsonObject,
  newsDay,
  QUOTE_DATE_KEY,
  QUOTE_KEY,
} from "./asof";

/** A series can run to thousands of rows; the ledger indexes the newest slice, the payload keeps all. */
export const MAX_TABLE_ROWS = 200;
/** Macro series would otherwise contribute a fact per row. */
const MAX_SERIES_FACTS = 24;

const OHLCV = ["open", "high", "low", "close", "volume"];
/** Date fields of the row shapes Alpha Vantage returns, in the order they are looked for. */
const ROW_DATE_FIELDS = ["date", "transaction_date", "reportedDate", "fiscalDateEnding"];

export interface Normalized {
  details: StructuredDetails;
  /** Lines to append to the result text, e.g. that only the newest rows were indexed. */
  notes: string[];
}

/** The parts a shape reader knows; `numbers` only where the text holds more than the figures. */
type Shape = Omit<StructuredDetails, "asOf" | "source" | "availableAt"> & { summary: string; asOf?: string };

/** `05. price` → `price`: Alpha Vantage numbers its keys. */
function fieldName(key: string): string {
  return key.replace(/^\d+\.\s*/, "").trim();
}

function records(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * A number from a JSON field, which Alpha Vantage usually sends as a string, sometimes with
 * thousands separators, a `%` or a `$`. It writes a missing value as `None`, `-` or `--`.
 */
function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/[,%$]/g, "");
  if (!cleaned || cleaned === "None" || cleaned === "-" || cleaned === "--") return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A table cell we can parse exactly, or null. Alpha Vantage writes a missing value as `.`. */
function cell(value: unknown): number | null {
  return numberOrUndefined(value) ?? null;
}

function unitOf(metric: string, raw: unknown): string {
  if (typeof raw === "string" && raw.trim().endsWith("%")) return "%";
  if (/eps|per share/i.test(metric) || metric === "surprise") return "USD/share";
  if (/volume|shares/i.test(metric)) return "shares";
  if (/percent|percentage/i.test(metric)) return "%";
  if (/yield|ratio|margin/i.test(metric)) return "ratio";
  return "USD";
}

function factsFrom(record: JsonObject, period: string, keys: string[], currency = "USD"): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  for (const key of keys) {
    const value = numberOrUndefined(record[key]);
    if (value === undefined) continue;
    const unit = unitOf(key, record[key]);
    facts.push({ metric: canonicalMetric(fieldName(key)), period, value, unit: unit === "USD" ? currency : unit });
  }
  return facts;
}

/** `Alpha Vantage TIME_SERIES_DAILY, $NVDA`: the summary of a response no shape reader knows. */
export function alphaVantageSummary(fn: string, args: Record<string, unknown>): StructuredDetails {
  const subject = entityFromArgs(args)?.ticker;
  return { summary: `Alpha Vantage ${fn}${subject ? `, $${subject}` : ""}` };
}

/* ------------------------------------------------------- dates and tables */

function rowDay(row: JsonObject): string | undefined {
  for (const field of ROW_DATE_FIELDS) {
    const day = isoDay(row[field]);
    if (day) return day;
  }
  return newsDay(row.time_published);
}

/** Every date the response actually contains, so `asOf` is the latest one present. */
function candidateDays(payload: JsonObject): string[] {
  const days: string[] = [];
  for (const value of Object.values(payload)) {
    if (isDateKeyedObject(value)) {
      days.push(...Object.keys(value).map((key) => key.slice(0, 10)));
    } else if (Array.isArray(value)) {
      for (const row of value) {
        if (!isRecord(row)) continue;
        const day = rowDay(row);
        if (day) days.push(day);
      }
    }
  }
  const quote = payload[QUOTE_KEY];
  if (isRecord(quote)) {
    const day = isoDay(quote[QUOTE_DATE_KEY]);
    if (day) days.push(day);
  }
  return days;
}

/** The first top-level date-keyed object: the price series or the indicator series. */
function series(payload: JsonObject): JsonObject | undefined {
  for (const value of Object.values(payload)) if (isDateKeyedObject(value)) return value;
  return undefined;
}

/** Daily, weekly and monthly series (adjusted or not) as `date, open, high, low, close, volume`. */
function ohlcvTable(payload: JsonObject): EvidenceTable | undefined {
  const found = series(payload);
  if (!found) return undefined;

  const rows: (string | number | null)[][] = [];
  for (const [date, entry] of Object.entries(found).sort(([a], [b]) => (a < b ? 1 : -1))) {
    if (!isRecord(entry)) return undefined;
    const byName = new Map(Object.entries(entry).map(([key, value]) => [fieldName(key).toLowerCase(), value]));
    // Indicator series (SMA, RSI) carry a single column; only a real OHLC row becomes a table.
    if (!["open", "high", "low", "close"].every((column) => byName.has(column))) return undefined;
    rows.push([date, ...OHLCV.map((column) => cell(byName.get(column)))]);
    if (rows.length === MAX_TABLE_ROWS) break;
  }
  return rows.length ? { columns: ["date", ...OHLCV], rows, index: "date" } : undefined;
}

/** The macro series (`TREASURY_YIELD`, `CPI`, …) as `date, value`. */
function macroTable(payload: JsonObject): EvidenceTable | undefined {
  const data = payload.data;
  if (!Array.isArray(data)) return undefined;

  const dated: [string, number | null][] = [];
  for (const row of data) {
    if (!isRecord(row) || !("value" in row)) return undefined;
    const day = isoDay(row.date);
    if (!day) return undefined;
    dated.push([day, cell(row.value)]);
  }
  if (!dated.length) return undefined;

  const rows = dated
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, MAX_TABLE_ROWS)
    .map(([day, value]): (string | number | null)[] => [day, value]);
  return { columns: ["date", "value"], rows, index: "date" };
}

/** How many rows the table was built from, so a truncated table can say so. */
function totalRows(payload: JsonObject): number {
  const found = series(payload);
  if (found) return Object.keys(found).length;
  return Array.isArray(payload.data) ? payload.data.length : 0;
}

/** Report rows as a table: the date column first, then every column that parses as a number. */
function reportTable(rows: JsonObject[], dateKey: string, fixed?: string[]): EvidenceTable {
  const numeric = new Set<string>();
  if (!fixed) {
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (key !== dateKey && numberOrUndefined(value) !== undefined) numeric.add(key);
      }
    }
  }
  const columns = fixed ?? [dateKey, ...numeric];
  return {
    columns,
    rows: rows.slice(0, MAX_TABLE_ROWS).map((row) =>
      columns.map((key) => {
        const value = row[key];
        if (key === dateKey) return toIsoDate(String(value ?? "")) ?? String(value ?? "");
        return numberOrUndefined(value) ?? (typeof value === "string" ? value : null);
      }),
    ),
    index: dateKey,
  };
}

/* ------------------------------------------------------------- the shapes */

const QUOTE_METRICS = ["price", "open", "high", "low", "volume", "previous close", "change", "change percent"];

function fromQuote(payload: JsonObject): Shape | undefined {
  const quote = payload[QUOTE_KEY];
  if (!isRecord(quote)) return undefined;
  const byName: JsonObject = {};
  for (const [key, value] of Object.entries(quote)) byName[fieldName(key)] = value;

  const symbol = typeof byName.symbol === "string" ? byName.symbol.toUpperCase() : undefined;
  const period = toIsoDate(String(byName["latest trading day"] ?? "")) ?? "";
  return {
    summary: `Alpha Vantage quote${symbol ? `, $${symbol}` : ""}${period ? ` as of ${period}` : ""}`,
    entity: symbol ? { ticker: symbol } : undefined,
    asOf: period || undefined,
    periods: period ? [period] : undefined,
    currency: "USD",
    facts: factsFrom(byName, period, QUOTE_METRICS),
  };
}

const STATEMENT_LINES = [
  "totalRevenue",
  "grossProfit",
  "operatingIncome",
  "netIncome",
  "ebitda",
  "totalAssets",
  "totalLiabilities",
  "totalShareholderEquity",
  "cashAndCashEquivalentsAtCarryingValue",
  "operatingCashflow",
  "capitalExpenditures",
];

function fromReports(payload: JsonObject, fn: string): Shape | undefined {
  const groups = (["quarterly", "annual"] as const).map((periodType) => ({ periodType, rows: records(payload[`${periodType}Reports`]) }));
  const rows = groups.flatMap((group) => group.rows);
  if (rows.length === 0) return undefined;
  const quarterly = records(payload.quarterlyReports).length > 0;
  const symbol = typeof payload.symbol === "string" ? payload.symbol.toUpperCase() : undefined;
  const periods = rows.map((row) => String(row.fiscalDateEnding ?? "")).filter(Boolean);
  const facts = groups.flatMap((group) => group.rows.flatMap((row) =>
    factsFrom(
      row,
      String(row.fiscalDateEnding ?? ""),
      STATEMENT_LINES,
      typeof row.reportedCurrency === "string" ? row.reportedCurrency : "USD",
    ).map((fact) => ({ ...fact, periodType: fn === "BALANCE_SHEET" ? "instant" as const : group.periodType })),
  ));

  return {
    summary: `Alpha Vantage ${fn}${symbol ? `, $${symbol}` : ""}, ${rows.length} ${quarterly ? "quarterly and annual" : "annual"} periods`,
    entity: symbol ? { ticker: symbol } : undefined,
    asOf: latestDate(periods.map((period) => toIsoDate(period))),
    periods,
    currency: "USD",
    facts,
    table: reportTable(rows, "fiscalDateEnding"),
  };
}

const EARNINGS_COLUMNS = ["fiscalDateEnding", "reportedDate", "reportedEPS", "estimatedEPS", "surprise", "surprisePercentage"];

function fromEarnings(payload: JsonObject): Shape | undefined {
  const rows = records(payload.quarterlyEarnings);
  const annual = records(payload.annualEarnings);
  if (rows.length === 0 && annual.length === 0) return undefined;
  const used = rows.length ? rows : annual;
  const symbol = typeof payload.symbol === "string" ? payload.symbol.toUpperCase() : undefined;
  const periods = used.map((row) => String(row.fiscalDateEnding ?? "")).filter(Boolean);
  const facts = used.flatMap((row) =>
    factsFrom(row, String(row.fiscalDateEnding ?? ""), EARNINGS_COLUMNS.slice(2))
      .map((fact) => ({ ...fact, periodType: rows.length ? "quarterly" as const : "annual" as const })),
  );

  return {
    summary: `Alpha Vantage EARNINGS${symbol ? `, $${symbol}` : ""}, ${used.length} periods`,
    entity: symbol ? { ticker: symbol } : undefined,
    asOf: latestDate(used.map((row) => toIsoDate(String(row.reportedDate ?? row.fiscalDateEnding ?? "")))),
    periods,
    facts,
    table: reportTable(used, "fiscalDateEnding", rows.length ? EARNINGS_COLUMNS : ["fiscalDateEnding", "reportedEPS"]),
  };
}

function fromOverview(payload: JsonObject): Shape | undefined {
  if (typeof payload.Symbol !== "string" || !("MarketCapitalization" in payload || "PERatio" in payload)) {
    return undefined;
  }
  const symbol = payload.Symbol.toUpperCase();
  const period = toIsoDate(String(payload.LatestQuarter ?? "")) ?? "";
  const numericKeys = Object.keys(payload).filter((key) => numberOrUndefined(payload[key]) !== undefined);

  return {
    summary: `Alpha Vantage OVERVIEW, $${symbol}${period ? ` (latest quarter ${period})` : ""}`,
    entity: { ticker: symbol, name: typeof payload.Name === "string" ? payload.Name : undefined },
    asOf: period || undefined,
    currency: typeof payload.Currency === "string" ? payload.Currency : "USD",
    facts: factsFrom(payload, period, numericKeys),
  };
}

function fromNews(payload: JsonObject): Shape | undefined {
  const feed = records(payload.feed);
  if (feed.length === 0) return undefined;
  const published = feed.map((item) => toIsoDate(String(item.time_published ?? "")));
  // Only headlines and summaries: sentiment scores and relevance weights are not figures a
  // reader would ever quote.
  const prose = feed.map((item) => `${String(item.title ?? "")}. ${String(item.summary ?? "")}`).join("\n");

  return {
    summary: `Alpha Vantage NEWS_SENTIMENT, ${feed.length} article${feed.length === 1 ? "" : "s"}`,
    asOf: latestDate(published),
    numbers: extractNumbers(prose),
  };
}

function fromMacro(payload: JsonObject, fn: string): Shape | undefined {
  const rows = records(payload.data);
  if (rows.length === 0 || !("value" in rows[0])) return undefined;
  const metric = canonicalMetric(String(payload.name ?? fn));
  const unit = typeof payload.unit === "string" ? payload.unit : "%";
  const dated = rows
    .map((row) => ({ date: toIsoDate(String(row.date ?? "")) ?? "", value: numberOrUndefined(row.value) }))
    .filter((row) => row.date !== "")
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    summary: `Alpha Vantage ${fn}, ${dated.length} observation${dated.length === 1 ? "" : "s"}${dated[0] ? ` (latest ${dated[0].date})` : ""}`,
    asOf: dated[0]?.date,
    unit,
    facts: dated
      .slice(0, MAX_SERIES_FACTS)
      .filter((row): row is { date: string; value: number } => row.value !== undefined)
      .map((row) => ({ metric, period: row.date, value: row.value, unit })),
  };
}

function fromTimeSeries(payload: JsonObject, fn: string, entity?: EvidenceEntity): Shape | undefined {
  const key = Object.keys(payload).find((name) => /^(?:Time Series|Weekly|Monthly)/i.test(name));
  const found = key ? payload[key] : undefined;
  if (!isRecord(found)) return undefined;

  const dates = Object.keys(found).sort((a, b) => b.localeCompare(a));
  const newest = dates.slice(0, MAX_TABLE_ROWS).find((date) => isRecord(found[date]));
  if (newest === undefined) return undefined;
  const byName: JsonObject = {};
  for (const [field, value] of Object.entries(found[newest] as JsonObject)) byName[fieldName(field)] = value;
  const close = numberOrUndefined(byName.close) ?? numberOrUndefined(byName["adjusted close"]);

  const latest = toIsoDate(dates[0]) ?? dates[0];
  return {
    summary: `Alpha Vantage ${fn}${entity?.ticker ? `, $${entity.ticker}` : ""}, ${dates.length} rows (latest ${latest}${close !== undefined ? `, close ${close}` : ""})`,
    asOf: latest,
    currency: "USD",
    facts: close !== undefined ? [{ metric: "close", period: latest, value: close, unit: "USD", end: latest }] : [],
  };
}

const ETF_METRICS = ["net_assets", "net_expense_ratio", "portfolio_turnover", "dividend_yield"];

function fromEtfProfile(payload: JsonObject, entity?: EvidenceEntity): Shape | undefined {
  if (!("net_expense_ratio" in payload) && !("net_assets" in payload)) return undefined;
  const holdings = records(payload.holdings);
  const asOf = toIsoDate(String(payload.as_of_date ?? ""));

  return {
    summary: `Alpha Vantage ETF_PROFILE${entity?.ticker ? `, $${entity.ticker}` : ""}, ${holdings.length} holdings`,
    asOf,
    facts: factsFrom(payload, asOf ?? "current", ETF_METRICS),
    table: holdings.length
      ? {
          columns: ["symbol", "description", "weight"],
          rows: holdings
            .slice(0, MAX_TABLE_ROWS)
            .map((holding) => [String(holding.symbol ?? ""), String(holding.description ?? ""), numberOrUndefined(holding.weight) ?? null]),
          index: "symbol",
        }
      : undefined,
  };
}

function shapeOf(fn: string, args: Record<string, unknown>, payload: JsonObject): Shape | undefined {
  const fromArgs = entityFromArgs(args);
  return fromQuote(payload) ??
    fromReports(payload, fn) ??
    fromEarnings(payload) ??
    fromOverview(payload) ??
    fromEtfProfile(payload, fromArgs) ??
    fromNews(payload) ??
    fromMacro(payload, fn) ??
    fromTimeSeries(payload, fn, fromArgs);
}

/* ------------------------------------------------------------ the entries */

/**
 * Everything the ledger takes from one JSON response. The date is the latest one the response
 * contains and the table is the price or macro series where there is one; the shape reader adds
 * the summary, the facts and the tables of reports.
 */
export function alphaVantageDetails(fn: string, args: Record<string, unknown>, payload: JsonObject): Normalized {
  const days = candidateDays(payload);
  const seriesTable = ohlcvTable(payload) ?? macroTable(payload);
  const shape = shapeOf(fn, args, payload);

  const details: StructuredDetails = shape
    ? {
        summary: shape.summary,
        entity: shape.entity,
        periods: shape.periods,
        unit: shape.unit,
        currency: shape.currency,
        facts: shape.facts?.length ? shape.facts : undefined,
        table: seriesTable ?? shape.table,
        // A known shape with no facts has nothing else worth sourcing in its text.
        numbers: shape.numbers ?? (shape.facts?.length ? undefined : []),
      }
    : { ...alphaVantageSummary(fn, args), table: seriesTable };
  const asOf = latestDate(days) ?? shape?.asOf;
  if (asOf) details.asOf = asOf;

  const total = seriesTable ? totalRows(payload) : 0;
  const notes =
    seriesTable && total > seriesTable.rows.length
      ? [`Evidence table: the newest ${seriesTable.rows.length} of ${total} rows were indexed.`]
      : [];
  return { details: withoutUndefined(details), notes };
}

/* -------------------------------------------------------------------- csv */

/** The CSV header as table columns: the column that dates a row is always called `date`. */
function csvColumns(body: CsvBody): string[] {
  return body.header.map((name, index) => (index === body.dateColumn ? "date" : name.trim().toLowerCase()));
}

/** A CSV cell as a number when it is one, otherwise the text as written. */
function csvCell(value: string | undefined): string | number | null {
  if (value === undefined || value.trim() === "") return null;
  return cell(value) ?? value;
}

/**
 * The same details for a CSV body: the latest date the rows carry and the rows themselves as
 * a table. `scheduled` marks a forward calendar, whose latest row dates something that has not
 * happened yet and so is not an as-of date.
 */
export function alphaVantageCsvDetails(
  fn: string,
  args: Record<string, unknown>,
  body: CsvBody,
  rows: string[][],
  scheduled: boolean,
): Normalized {
  const dated = rows
    .map((row): [string | undefined, string[]] => [csvRowDay(body, row), row])
    .filter((entry): entry is [string, string[]] => entry[0] !== undefined)
    .sort(([a], [b]) => (a < b ? 1 : -1));

  const details: StructuredDetails = alphaVantageSummary(fn, args);
  if (dated.length && !scheduled) details.asOf = dated[0][0];

  const shown = dated.slice(0, MAX_TABLE_ROWS);
  if (shown.length) {
    details.table = {
      columns: csvColumns(body),
      rows: shown.map(([day, row]) => row.map((value, index) => (index === body.dateColumn ? day : csvCell(value)))),
      index: "date",
    };
  }

  const notes =
    shown.length < dated.length
      ? [`Evidence table: the newest ${shown.length} of ${dated.length} rows were indexed.`]
      : [];
  return { details, notes };
}

function withoutUndefined(details: StructuredDetails): StructuredDetails {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)) as StructuredDetails;
}
