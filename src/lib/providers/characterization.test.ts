/**
 * What the evidence ledger makes of every kind of data result, pinned: `normalizeResult` over
 * results the real EDGAR, Alpha Vantage, Tavily and market quote tools produce from recorded provider responses
 * (through the `sourceRequest` seam, so nothing touches the network). What the benchmark's offline
 * mock serves for the same tools is pinned beside it, in `evals/offline/`. A change to the snapshot
 * is a change to what the model and the checks see, so it has to be deliberate.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type SourceSnapshot, withSourceSnapshot } from "@/lib/data/source-snapshot";
import { acmeModule } from "@/lib/providers/example/module";
import { alphaVantageModule, alphaVantageToolOptions } from "@/lib/providers/alphavantage/module";
import { edgarModule } from "@/lib/providers/edgar/module";
import { quotesModule } from "@/lib/quotes/tool";
import { tavilyModule } from "@/lib/providers/tavily/module";
import { stableStringify } from "@/lib/text/stable-json";
import type { FinanceTool, Module, ToolMeta } from "@/lib/tools/contracts";
import { offlineContext } from "@/lib/tools/testing";
import { edgarUrls, respond } from "./characterization.fixture";
import { type CharacterizationCase as Case, normalizedCases } from "./testing";

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-characterization-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

const recorded: SourceSnapshot = {
  async resolve<T>(request: Parameters<SourceSnapshot["resolve"]>[0]): Promise<T> {
    const value = respond(request);
    if (value === undefined) throw new Error(`No recorded response for ${stableStringify(request, { omitUndefined: true })}`);
    return value as T;
  },
};

async function build(module: Module, cfg: Record<string, unknown>, asOf?: string): Promise<Map<string, FinanceTool>> {
  const tools = await withSourceSnapshot(recorded, () => module.createTools({ ...module.defaultConfig, enabled: true, ...cfg }, offlineContext({ asOf })));
  return new Map(tools.map((tool) => [tool.name, tool]));
}

async function run(label: string, tools: Map<string, FinanceTool>, name: string, args: Record<string, unknown>): Promise<Case> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`${label}: no tool ${name}`);
  const result = await withSourceSnapshot(recorded, () => tool.execute(label, args));
  return { label, tool, args, result };
}

async function liveCases(): Promise<Case[]> {
  const contact = { contact: "Test test@example.com" };
  const edgar = await build(edgarModule, contact);
  const edgarAsOf = await build(edgarModule, contact, "2025-06-30");
  const edgarEarly = await build(edgarModule, contact, "2023-01-01");
  const av = { apiKey: "demo", allowTools: alphaVantageToolOptions, cacheTtlSeconds: 0 };
  const alpha = await build(alphaVantageModule, av);
  const alphaAsOf = await build(alphaVantageModule, av, "2024-08-27");
  const web = await build(tavilyModule, { apiKey: "tvly-test" });
  const webAsOf = await build(tavilyModule, { apiKey: "tvly-test" }, "2024-08-29");
  const quotes = await build(quotesModule, {});

  return Promise.all([
    run("edgar lookup, one match", edgar, "edgar_lookup_company", { query: "FIXT" }),
    run("edgar lookup, several matches", edgar, "edgar_lookup_company", { query: "fixture" }),
    run("edgar lookup, no match", edgar, "edgar_lookup_company", { query: "zzzz" }),
    run("edgar filings", edgar, "edgar_filings", { ticker: "FIXT" }),
    run("edgar filings, 8-K", edgar, "edgar_filings", { ticker: "fixt", forms: ["8-K"] }),
    run("edgar filings, as of", edgarAsOf, "edgar_filings", { ticker: "FIXT", limit: 5 }),
    run("edgar filings, none", edgar, "edgar_filings", { ticker: "FIXT", forms: ["S-1"] }),
    run("edgar income, quarterly", edgar, "edgar_financials", { ticker: "FIXT", statement: "income", period: "quarterly" }),
    run("edgar balance, annual", edgar, "edgar_financials", { ticker: "fixt", statement: "balance", period: "annual" }),
    run("edgar key metrics, quarterly", edgar, "edgar_financials", { ticker: "FIXT", statement: "key_metrics", period: "quarterly", limit: 4 }),
    run("edgar cash flow, as of", edgarAsOf, "edgar_financials", { ticker: "FIXT", statement: "cashflow", period: "quarterly" }),
    run("edgar income, before any filing", edgarEarly, "edgar_financials", { ticker: "FIXT", statement: "income", period: "annual" }),
    run("edgar search", edgar, "edgar_search_filings", { query: "second quarter revenue" }),
    run("edgar search, as of", edgarAsOf, "edgar_search_filings", { query: "second quarter revenue", forms: ["8-K"] }),
    run("edgar read, index", edgar, "edgar_read_filing", { url: edgarUrls.index }),
    run("edgar read, document", edgar, "edgar_read_filing", { url: edgarUrls.document }),
    run("edgar read, document with a query", edgar, "edgar_read_filing", { url: edgarUrls.document, query: "outlook revenue" }),
    run("av quote", alpha, "alphavantage__GLOBAL_QUOTE", { symbol: "NVDA" }),
    run("av quote, withheld as of", alphaAsOf, "alphavantage__GLOBAL_QUOTE", { symbol: "NVDA" }),
    run("av daily", alpha, "alphavantage__TIME_SERIES_DAILY", { symbol: "nvda" }),
    run("av daily, trimmed as of", alphaAsOf, "alphavantage__TIME_SERIES_DAILY", { symbol: "NVDA" }),
    run("av income statement", alpha, "alphavantage__INCOME_STATEMENT", { symbol: "NVDA" }),
    run("av balance sheet", alpha, "alphavantage__BALANCE_SHEET", { symbol: "NVDA" }),
    run("av earnings", alpha, "alphavantage__EARNINGS", { symbol: "NVDA" }),
    run("av overview", alpha, "alphavantage__COMPANY_OVERVIEW", { symbol: "NVDA" }),
    run("av news", alpha, "alphavantage__NEWS_SENTIMENT", { tickers: "NVDA" }),
    run("av treasury yield", alpha, "alphavantage__TREASURY_YIELD", { maturity: "10year" }),
    run("av etf profile", alpha, "alphavantage__ETF_PROFILE", { symbol: "QQQ" }),
    run("av symbol search", alpha, "alphavantage__SYMBOL_SEARCH", { keywords: "nvidia" }),
    run("av earnings calendar, csv", alpha, "alphavantage__EARNINGS_CALENDAR", { symbol: "NVDA" }),
    run("av earnings calendar, csv as of", alphaAsOf, "alphavantage__EARNINGS_CALENDAR", { symbol: "NVDA" }),
    run("av insider transactions, csv as of", alphaAsOf, "alphavantage__INSIDER_TRANSACTIONS", { symbol: "NVDA" }),
    run("market quotes", quotes, "market_quotes", { symbols: ["nvda"] }),
    run("market quotes, batch with a missing symbol", quotes, "market_quotes", { symbols: ["NVDA", "AAPL", "ZZZZ"] }),
    run("web search", web, "web_search", { query: "Nvidia second quarter results" }),
    run("web fetch", web, "web_fetch", { urls: ["https://www.sec.gov/Archives/edgar/data/1045810/000104581024000264/q2fy25pr.htm", "https://blocked.example/page"] }),
    run("web fetch, as of with a query", webAsOf, "web_fetch", { urls: ["https://www.sec.gov/Archives/edgar/data/1045810/000104581024000264/q2fy25pr.htm"], query: "outlook" }),
  ]);
}

/** Results that are not a built-in provider's: the example module, and a generic MCP data server. */
async function otherCases(): Promise<Case[]> {
  const acme = await build(acmeModule, { apiKey: "key" });
  const mcpMeta: ToolMeta = { class: "data", effect: "external", source: { id: "fmp", name: "Financial Modeling Prep", tier: 2, coverage: ["prices"] } };
  return [
    await run("example provider", acme, "acme_prices", { ticker: "NVDA" }),
    {
      label: "generic MCP data server",
      tool: { name: "fmp__quote", meta: mcpMeta },
      args: { symbol: "nvda" },
      result: { content: [{ type: "text", text: "NVDA last $125.61, down 2.1% on the day; market cap $3.09T. Updated 2024-08-28." }], details: {} },
    },
  ];
}

describe("normalizeResult characterization", () => {
  it("pins the entries of live provider results", async () => {
    await expect(normalizedCases([...(await liveCases()), ...(await otherCases())])).toMatchFileSnapshot("./characterization.live.snap.json");
  });
});
