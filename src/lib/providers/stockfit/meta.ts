import type { CoverageDomain, SourceTier, ToolMeta } from "@/lib/tools/contracts";

/** Stable source id; the evidence ledger and the policy engine key on it. */
export const STOCKFIT_SOURCE_ID = "stockfit";
export const STOCKFIT_SOURCE_NAME = "StockFit";
/** Licensed vendor, even though each statement value names the filing it came from. */
export const STOCKFIT_TIER: SourceTier = 2;

export const STATEMENT_TOOLS = new Set([
  "financials_income_statement",
  "financials_balance_sheet",
  "financials_cash_flow_statement",
]);
export const PRICE_HISTORY_TOOL = "price_history";

/**
 * Coverage by tool-name prefix, first match wins. A tool we do not know counts as fundamentals,
 * which most of the server's tools are.
 */
const coverageByPrefix: [string, CoverageDomain[]][] = [
  ["lookup_news", ["news"]],
  ["financials_", ["fundamentals"]],
  ["footnotes_", ["fundamentals"]],
  ["earnings_", ["earnings"]],
  ["filings", ["filings"]],
  ["executives_", ["filings"]],
  ["price_", ["prices"]],
  ["fund_", ["funds"]],
  ["ownership_", ["ownership"]],
  ["insider_", ["ownership"]],
  ["congress_", ["ownership"]],
];

export function stockfitCoverage(toolName: string): CoverageDomain[] {
  return coverageByPrefix.find(([prefix]) => toolName.startsWith(prefix))?.[1] ?? ["fundamentals"];
}

/**
 * The tools `trimToAsOf` really rewinds, and so the only ones a historical turn is offered. The rest
 * return what the server sends today, and some (EPS history, filings) carry no filing date to cut on.
 */
export function stockfitSupportsAsOf(toolName: string): boolean {
  return STATEMENT_TOOLS.has(toolName) || toolName === PRICE_HISTORY_TOOL;
}

/** Domains a StockFit connection covers, given the tools the user allowed. */
export function stockfitServerCoverage(toolNames: string[]): CoverageDomain[] {
  const domains = new Set<CoverageDomain>();
  for (const name of toolNames) for (const domain of stockfitCoverage(name)) domains.add(domain);
  return [...domains];
}

/** Metadata for one StockFit tool, by its raw MCP tool name. */
export function stockfitMeta(toolName: string): ToolMeta {
  return {
    class: "data",
    effect: "read",
    supportsAsOf: stockfitSupportsAsOf(toolName),
    source: { id: STOCKFIT_SOURCE_ID, name: STOCKFIT_SOURCE_NAME, tier: STOCKFIT_TIER, coverage: stockfitCoverage(toolName) },
  };
}
