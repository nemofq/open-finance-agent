import type { CoverageDomain, SourceTier, ToolMeta } from "@/lib/tools/contracts";

/** Stable source id; the evidence ledger and the policy engine key on it. */
export const ALPHA_VANTAGE_SOURCE_ID = "alphavantage";
export const ALPHA_VANTAGE_SOURCE_NAME = "Alpha Vantage";
/** Licensed market-data vendor. */
export const ALPHA_VANTAGE_TIER: SourceTier = 2;

/**
 * Coverage of the functions that are not price data. Everything else — quotes, time series,
 * technical indicators, market status, symbol search, the IPO calendar — falls through to
 * `["prices"]`, which is also the safe default for a function we do not know.
 */
const coverageByFunction: Record<string, CoverageDomain[]> = {
  COMPANY_OVERVIEW: ["fundamentals"],
  INCOME_STATEMENT: ["fundamentals"],
  BALANCE_SHEET: ["fundamentals"],
  CASH_FLOW: ["fundamentals"],
  EARNINGS: ["earnings", "estimates"],
  EARNINGS_CALENDAR: ["earnings", "estimates"],
  EARNINGS_CALL_TRANSCRIPT: ["transcripts"],
  NEWS_SENTIMENT: ["news"],
  INSIDER_TRANSACTIONS: ["ownership"],
  INSTITUTIONAL_HOLDINGS: ["ownership"],
  TREASURY_YIELD: ["macro"],
  FEDERAL_FUNDS_RATE: ["macro"],
  CPI: ["macro"],
  INFLATION: ["macro"],
  UNEMPLOYMENT: ["macro"],
  RETAIL_SALES: ["macro"],
  ETF_PROFILE: ["funds"],
  HISTORICAL_OPTIONS: ["options"],
};

/**
 * Functions `trimToAsOf` really rewinds. Anything absent here returns whatever the vendor
 * sends today: a quote feed, a forward calendar, a profile with no dates to cut on.
 * `GLOBAL_QUOTE` counts because under an as-of date it withholds a later quote entirely.
 */
const trimmedFunctions = new Set([
  "GLOBAL_QUOTE",
  "SMA",
  "EMA",
  "RSI",
  "MACD",
  "NEWS_SENTIMENT",
  "EARNINGS",
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
  "CASH_FLOW",
  "INSIDER_TRANSACTIONS",
  "HISTORICAL_OPTIONS",
  "TREASURY_YIELD",
  "FEDERAL_FUNDS_RATE",
  "CPI",
  "INFLATION",
  "UNEMPLOYMENT",
  "RETAIL_SALES",
]);

/** Every `TIME_SERIES_*` variant (daily, adjusted, weekly, monthly, intraday) is a date-keyed series. */
function isTimeSeries(toolName: string): boolean {
  return toolName.startsWith("TIME_SERIES_");
}

export function alphaVantageCoverage(toolName: string): CoverageDomain[] {
  return coverageByFunction[toolName] ?? ["prices"];
}

export function alphaVantageSupportsAsOf(toolName: string): boolean {
  return isTimeSeries(toolName) || trimmedFunctions.has(toolName);
}

/** Profile ratios and holdings are current snapshots, with no historical query parameter. */
export function alphaVantageIsCurrentOnly(toolName: string): boolean {
  return toolName === "COMPANY_OVERVIEW" || toolName === "ETF_PROFILE";
}

/** Domains an Alpha Vantage connection covers, given the tools the user allowed. */
export function alphaVantageServerCoverage(toolNames: string[]): CoverageDomain[] {
  const domains = new Set<CoverageDomain>();
  for (const name of toolNames) for (const domain of alphaVantageCoverage(name)) domains.add(domain);
  return [...domains];
}

/** Metadata for one Alpha Vantage function, by its raw MCP tool name. */
export function alphaVantageMeta(toolName: string): ToolMeta {
  return {
    class: "data",
    effect: "read",
    supportsAsOf: alphaVantageSupportsAsOf(toolName),
    source: {
      id: ALPHA_VANTAGE_SOURCE_ID,
      name: ALPHA_VANTAGE_SOURCE_NAME,
      tier: ALPHA_VANTAGE_TIER,
      coverage: alphaVantageCoverage(toolName),
    },
  };
}
