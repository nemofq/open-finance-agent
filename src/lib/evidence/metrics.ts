/**
 * One name per financial line, so a fact from EDGAR and the same fact from Alpha Vantage
 * meet in `findFacts` and in the automatic cross-check.
 */
import type { EvidenceEntry, EvidenceFact } from "./types";

/** Canonical metric name for each spelling we have seen from a source or a caller. */
const ALIASES: Record<string, string> = {
  revenue: "revenue",
  revenues: "revenue",
  sales: "revenue",
  "net sales": "revenue",
  "total revenue": "revenue",
  "total revenues": "revenue",
  totalrevenue: "revenue",
  "net revenue": "revenue",

  "cost of revenue": "costOfRevenue",
  costofrevenue: "costOfRevenue",
  "cost of goods sold": "costOfRevenue",
  cogs: "costOfRevenue",

  "gross profit": "grossProfit",
  grossprofit: "grossProfit",
  "gross margin": "grossMargin",
  grossmargin: "grossMargin",

  "operating income": "operatingIncome",
  operatingincome: "operatingIncome",
  "income from operations": "operatingIncome",
  "operating margin": "operatingMargin",
  ebit: "operatingIncome",
  ebitda: "ebitda",

  "net income": "netIncome",
  netincome: "netIncome",
  "net earnings": "netIncome",
  "net income loss": "netIncome",
  "profit loss": "netIncome",
  "net margin": "netMargin",

  eps: "dilutedEps",
  "diluted eps": "dilutedEps",
  dilutedeps: "dilutedEps",
  "earnings per share": "dilutedEps",
  "diluted earnings per share": "dilutedEps",
  reportedeps: "dilutedEps",
  "reported eps": "dilutedEps",
  "basic eps": "basicEps",
  estimatedeps: "estimatedEps",
  "estimated eps": "estimatedEps",
  "eps estimate": "estimatedEps",

  "diluted shares": "dilutedShares",
  dilutedshares: "dilutedShares",
  "shares outstanding": "sharesOutstanding",

  "total assets": "assets",
  totalassets: "assets",
  assets: "assets",
  "total liabilities": "liabilities",
  totalliabilities: "liabilities",
  liabilities: "liabilities",
  "shareholders equity": "equity",
  "shareholders' equity": "equity",
  "stockholders equity": "equity",
  totalshareholderequity: "equity",
  equity: "equity",
  cash: "cash",
  "cash and equivalents": "cash",
  "cash and cash equivalents": "cash",
  cashandcashequivalentsatcarryingvalue: "cash",
  "long-term debt": "longTermDebt",
  "long term debt": "longTermDebt",
  longtermdebt: "longTermDebt",

  "operating cash flow": "operatingCashFlow",
  operatingcashflow: "operatingCashFlow",
  "cash from operations": "operatingCashFlow",
  "capital expenditure": "capex",
  "capital expenditures": "capex",
  capitalexpenditures: "capex",
  capex: "capex",
  "free cash flow": "freeCashFlow",
  freecashflow: "freeCashFlow",
  fcf: "freeCashFlow",

  close: "close",
  "closing price": "close",
  price: "price",
  "share price": "price",
  open: "open",
  high: "high",
  low: "low",
  volume: "volume",
  "market cap": "marketCap",
  marketcapitalization: "marketCap",
  "market capitalization": "marketCap",
  peratio: "peRatio",
  "p/e": "peRatio",
  "pe ratio": "peRatio",
  dividendyield: "dividendYield",
  "dividend yield": "dividendYield",

  "revenue yoy": "revenueYoy",
  "revenue growth": "revenueYoy",
};

/** Lowercase, collapse whitespace and drop the punctuation label styles differ on. */
function normalize(metric: string): string {
  return metric
    .trim()
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ");
}

/** camelCase fallback for a line no alias covers, e.g. "Interest expense" → `interestExpense`. */
function camel(metric: string): string {
  const trimmed = metric.trim();
  // A vendor field is already one identifier (`surprisePercentage`); lowercasing it would lose the word break.
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(trimmed)) return trimmed[0].toLowerCase() + trimmed.slice(1);
  const words = normalize(metric).split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return normalize(metric);
  return words[0] + words.slice(1).map((word) => word[0].toUpperCase() + word.slice(1)).join("");
}

export function canonicalMetric(metric: string): string {
  const key = normalize(metric);
  return ALIASES[key] ?? ALIASES[key.replace(/[^a-z0-9]/g, "")] ?? camel(metric);
}

/** True when two metric names mean the same line. */
export function sameMetric(a: string, b: string): boolean {
  return a === b || canonicalMetric(a) === canonicalMetric(b);
}

const periodKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const metricKey = (value: string) => value.toLowerCase().replace(/[\s_-]/g, "");

/**
 * The facts `entry` reports for `period`, and for `metric` when a cell or reference names one.
 * Periods compare loosely, on letters and digits alone, and a fact is also found by the date its
 * period ended. A metric matches by canonical name, or else exactly but for case and separators:
 * `Gross Margin` is `grossMargin`.
 */
export function factsFor(entry: EvidenceEntry, period: string, metric?: string): EvidenceFact[] {
  const wanted = periodKey(period);
  return (entry.facts ?? []).filter(
    (fact) =>
      [fact.period, fact.end].some((value) => value !== undefined && periodKey(value) === wanted) &&
      (metric === undefined || sameMetric(fact.metric, metric) || metricKey(fact.metric) === metricKey(metric)),
  );
}
