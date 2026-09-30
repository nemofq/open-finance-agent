/**
 * What the evidence ledger makes of the benchmark mock's results, pinned: `normalizeResult` over
 * what the offline mock serves for the production tools, in the format of the provider snapshot in
 * `src/lib/providers/`. A change to the snapshot is a change to what the model and the checks see
 * in a benchmark run, so it has to be deliberate.
 */
import { describe, expect, it } from "vitest";
import { type SourceSnapshot, withSourceSnapshot } from "@/lib/data/source-snapshot";
import { alphaVantageMeta } from "@/lib/providers/alphavantage/meta";
import { edgarModule } from "@/lib/providers/edgar/module";
import { tavilyModule } from "@/lib/providers/tavily/module";
import { type CharacterizationCase as Case, normalizedCases } from "@/lib/providers/testing";
import { quotesModule } from "@/lib/quotes/tool";
import type { FinanceTool, Module, ToolMeta } from "@/lib/tools/contracts";
import { offlineContext } from "@/lib/tools/testing";
import { loadDataset } from "./dataset";
import { MockMcpBridge } from "./mock-mcp-bridge";

const MOCK_TASK = "retail-01-nvda-beat-and-drop";

/** The production tools, built only for their metadata; none of them is called. */
const offline: SourceSnapshot = {
  resolve: async (request) => { throw new Error(`Building a tool must not load ${request.source}/${request.operation}`); },
};

async function build(module: Module, cfg: Record<string, unknown>): Promise<Map<string, FinanceTool>> {
  const tools = await withSourceSnapshot(offline, () => module.createTools({ ...module.defaultConfig, enabled: true, ...cfg }, offlineContext()));
  return new Map(tools.map((tool) => [tool.name, tool]));
}

async function mockCases(): Promise<Case[]> {
  const bridge = new MockMcpBridge(loadDataset(), MOCK_TASK);
  const edgar = await build(edgarModule, { contact: "Test test@example.com" });
  const web = await build(tavilyModule, { apiKey: "tvly-test" });
  const quotes = await build(quotesModule, {});
  const metaOf = (name: string): ToolMeta => edgar.get(name)?.meta ?? web.get(name)?.meta ?? quotes.get(name)?.meta ?? alphaVantageMeta(name.replace(/^alphavantage__/, ""));
  const call = async (label: string, name: string, args: Record<string, unknown>): Promise<Case> =>
    ({ label, tool: { name, meta: metaOf(name) }, args, result: await bridge.call(name, args, label) });
  try {
    const filings = await call("mock edgar filings", "edgar_filings", { ticker: "NVDA", forms: ["8-K"] });
    const table = (filings.result.details as { table?: { rows: unknown[][] } }).table;
    const url = String(table?.rows[0]?.[4] ?? "");
    return [
      await call("mock edgar lookup", "edgar_lookup_company", { query: "NVDA" }),
      filings,
      await call("mock edgar income", "edgar_financials", { ticker: "NVDA", statement: "income", period: "quarterly", limit: 8 }),
      await call("mock edgar key metrics, annual", "edgar_financials", { ticker: "NVDA", statement: "key_metrics", period: "annual" }),
      await call("mock edgar financials, unknown company", "edgar_financials", { ticker: "ZZZZ", statement: "income", period: "quarterly" }),
      await call("mock edgar search", "edgar_search_filings", { query: "data center" }),
      await call("mock edgar search, no match", "edgar_search_filings", { query: "zirconium widgets" }),
      await call("mock edgar read", "edgar_read_filing", { url }),
      await call("mock edgar read, query", "edgar_read_filing", { url, query: "revenue" }),
      await call("mock av daily", "alphavantage__TIME_SERIES_DAILY", { symbol: "NVDA" }),
      await call("mock av quote", "alphavantage__GLOBAL_QUOTE", { symbol: "NVDA" }),
      await call("mock av overview", "alphavantage__COMPANY_OVERVIEW", { symbol: "NVDA" }),
      await call("mock av news", "alphavantage__NEWS_SENTIMENT", { tickers: "NVDA" }),
      await call("mock av earnings", "alphavantage__EARNINGS", { symbol: "NVDA" }),
      await call("mock market quotes", "market_quotes", { symbols: ["NVDA"] }),
      await call("mock market quotes, batch with a missing symbol", "market_quotes", { symbols: ["NVDA", "AMD", "ZZZZ"] }),
      await call("mock web search", "web_search", { query: "Nvidia second quarter fiscal 2025 results" }),
    ];
  } finally {
    await bridge.close();
  }
}

describe("normalizeResult characterization of the benchmark mock", () => {
  it("pins the entries of the mock's results", async () => {
    await expect(normalizedCases(await mockCases())).toMatchFileSnapshot("./mock-mcp-characterization.snap.json");
  });
});
