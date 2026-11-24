import type { McpServerConfig } from "@/lib/config/schema";
import type { RateLimit } from "@/lib/data/rate-limit";
import { connect } from "@/lib/mcp/client";
import { mcpServerTools, resultText } from "@/lib/mcp/tools";
import { settingList, settingNumber, settingString } from "@/lib/tools/config";
import type { FinanceTool, Module } from "@/lib/tools/contracts";
import { errorMessage, isRecord } from "@/lib/utils";
import { asOfArgs } from "./asof";
import { STOCKFIT_SOURCE_ID, STOCKFIT_SOURCE_NAME, STOCKFIT_TIER, stockfitMeta, stockfitServerCoverage, stockfitSupportsAsOf } from "./meta";
import { stockfitPostProcess } from "./postprocess";

const MCP_URL = "https://api.stockfit.io/mcp";
const DEFAULT_CACHE_TTL_SECONDS = 900;
const VALIDATE_TIMEOUT_MS = 20_000;

/** The free plan's per-minute limit. Calls over it wait for a slot rather than coming back as 429s. */
const RATE_LIMIT: RateLimit = { calls: 50, windowMs: 60_000 };

/** Tools a free key can call, chosen for research turns; the user can widen this in settings. */
const defaultStockfitTools = [
  "financials_income_statement",
  "financials_balance_sheet",
  "financials_cash_flow_statement",
  "earnings_eps_history",
  "earnings_dividend_history",
  "filings",
  "price_history",
  "company_details",
  "lookup_news",
];

/**
 * Offered as allowlist choices in settings. Past the defaults, most need a paid plan; the server lists
 * a tool the key's plan lacks as a one-line upgrade notice, so the model never calls it blind.
 */
export const stockfitToolOptions = [
  ...defaultStockfitTools,
  "financials_as_reported",
  "financials_key_metrics",
  "financials_growth",
  "footnotes_revenue_segmentation",
  "footnotes_business_segmentation",
  "footnotes_debt_structure",
  "footnotes_leases",
  "footnotes_stock_compensation",
  "footnotes_buybacks",
  "earnings_snapshot",
  "earnings_calendar",
  "ownership_institutional_holders",
  "ownership_beneficial_owners",
  "insider_transactions",
  "insider_transactions_summary",
  "executives_compensation",
  "company_peers",
  "filings_item_list",
  "filings_item",
  "fund_profile",
  "fund_holdings",
  "fund_reverse_lookup",
  "price_quote",
  "lookup_search",
];

type Cfg = Record<string, unknown>;

/** Zero turns the cache off; a negative or unreadable TTL is ignored. */
function cacheTtlSeconds(cfg: Cfg): number {
  const ttl = settingNumber(cfg, "cacheTtlSeconds");
  return ttl !== undefined && ttl >= 0 ? ttl : DEFAULT_CACHE_TTL_SECONDS;
}

/**
 * StockFit runs an official MCP server, so the module is a preset for the generic connector rather
 * than a hand-written tool set.
 */
export function stockfitPreset(cfg: Cfg): McpServerConfig {
  const allowTools = settingList(cfg, "allowTools", defaultStockfitTools);
  return {
    id: STOCKFIT_SOURCE_ID,
    name: STOCKFIT_SOURCE_NAME,
    enabled: true,
    class: "data",
    tier: STOCKFIT_TIER,
    coverage: stockfitServerCoverage(allowTools),
    transport: "http",
    url: MCP_URL,
    // StockFit's edge refuses a request that carries no User-Agent.
    headers: { Authorization: `Bearer ${settingString(cfg, "apiKey")}`, "User-Agent": "open-finance-agent" },
    allowTools,
    cacheTtlSeconds: cacheTtlSeconds(cfg),
  };
}

/** The key's plan as the server reports it: `free plan: 34 of 124 tools available`. */
async function describePlan(cfg: Cfg): Promise<string> {
  const client = await connect(stockfitPreset(cfg));
  const result = await client.callTool(
    { name: "list_available_tools_of_current_plan", arguments: {} },
    undefined,
    { signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS) },
  );
  const text = resultText(result.content as { type: string; text?: string }[] | undefined);
  if (result.isError) throw new Error(text || "StockFit refused the request.");
  const plan: unknown = JSON.parse(text);
  if (!isRecord(plan)) throw new Error("StockFit answered with an unexpected plan description.");
  return `${String(plan.currentTier)} plan: ${String(plan.accessibleCount)} of ${String(plan.totalTools)} tools available`;
}

export const stockfitModule: Module = {
  id: "stockfit",
  name: "StockFit",
  kind: "data-provider",
  description:
    "Financial statements with the filing behind every value, price history, EPS and dividends, filings and news via StockFit's official MCP server; paid plans add segments, footnotes, ownership and fund holdings.",

  settings: [
    {
      key: "apiKey",
      label: "API key",
      type: "secret",
      required: true,
      help: "Get a free key at developer.stockfit.io. Free plan: 300 requests/day, 50/minute.",
      helpUrl: "https://developer.stockfit.io",
    },
    {
      key: "allowTools",
      label: "Tools",
      type: "multiselect",
      options: stockfitToolOptions.map((value) => ({ value, label: value })),
      help: "Tools exposed to the agent; the defaults work on the free plan. Validate shows what your plan includes.",
    },
    {
      key: "cacheTtlSeconds",
      label: "Cache TTL (seconds)",
      type: "text",
      help: "Cache identical tool calls for this many seconds (default 900) to conserve the daily quota",
    },
  ],

  defaultConfig: {
    enabled: false,
    apiKey: "",
    allowTools: [...defaultStockfitTools],
    cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
  },

  async validate(cfg) {
    if (!settingString(cfg, "apiKey")) return { ok: false, message: "Enter your StockFit API key." };
    try {
      return { ok: true, message: `Connected. ${await describePlan(cfg)}.` };
    } catch (error) {
      const text = errorMessage(error);
      if (/\b401\b|unauthori[sz]ed/i.test(text)) return { ok: false, message: "StockFit rejected the API key. Check it in Settings › Data connections." };
      return { ok: false, message: `Could not reach StockFit: ${text}` };
    }
  },

  async createTools(cfg, ctx): Promise<FinanceTool[]> {
    if (!settingString(cfg, "apiKey")) return [];
    const asOf = ctx.asOf;
    return mcpServerTools(stockfitPreset(cfg), {
      // A historical turn gets only the tools that honour its cutoff; EDGAR covers the rest point in time.
      include: (name) => !asOf || stockfitSupportsAsOf(name),
      meta: stockfitMeta,
      // `asOf` is fixed for the turn; the rewritten arguments are also the cache key.
      prepareArgs: (args, accepts) => (asOf ? asOfArgs(args, accepts, asOf, new Date().toISOString().slice(0, 10)) : args),
      rateLimit: RATE_LIMIT,
      // After the cache, which holds the raw server text shared by turns with different as-of dates.
      postProcess: (toolName, args, body) => stockfitPostProcess(toolName, args, body, ctx.asOf),
    });
  },
};
