import type { McpServerConfig } from "@/lib/config/schema";
import type { RateLimit } from "@/lib/data/rate-limit";
import { mcpServerTools } from "@/lib/mcp/tools";
import type { SymbolHit } from "@/lib/tickers/types";
import { settingList, settingNumber, settingString } from "@/lib/tools/config";
import type { FinanceTool, Module } from "@/lib/tools/contracts";
import { errorMessage } from "@/lib/utils";
import {
  ALPHA_VANTAGE_SOURCE_ID,
  ALPHA_VANTAGE_SOURCE_NAME,
  ALPHA_VANTAGE_TIER,
  alphaVantageIsCurrentOnly,
  alphaVantageMeta,
  alphaVantageServerCoverage,
} from "./meta";
import { assertNoProblem } from "./errors";
import { alphaVantagePostProcess } from "./postprocess";
import { fetchQuote, searchSymbols } from "./rest";

const MCP_URL = "https://mcp.alphavantage.co/mcp";
const DEFAULT_CACHE_TTL_SECONDS = 900;

/**
 * The free tier allows 5 requests a minute, and the agent happily fires four calls at once and
 * then retries. Calls over the limit wait for a slot rather than coming back as rate-limit
 * notices the ledger would file as evidence.
 */
const RATE_LIMIT: RateLimit = { calls: 5, windowMs: 60_000, minSpacingMs: 1_100 };

/** Several functions default to CSV; JSON carries the field names the normalizer reads. */
function preferJson(args: Record<string, unknown>, accepts: ReadonlySet<string>): Record<string, unknown> {
  return accepts.has("datatype") && args.datatype === undefined ? { ...args, datatype: "json" } : args;
}

/** Alpha Vantage tools curated for earnings workflows; the user can widen this in settings. */
const defaultAlphaVantageTools = [
  "GLOBAL_QUOTE",
  "SYMBOL_SEARCH",
  "COMPANY_OVERVIEW",
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
  "CASH_FLOW",
  "EARNINGS",
  "EARNINGS_CALENDAR",
  "EARNINGS_CALL_TRANSCRIPT",
  "NEWS_SENTIMENT",
  "TIME_SERIES_DAILY",
  "INSIDER_TRANSACTIONS",
  "TOP_GAINERS_LOSERS",
  "TREASURY_YIELD",
  "FEDERAL_FUNDS_RATE",
  "CPI",
  "ETF_PROFILE",
];

/** Tools the Alpha Vantage MCP server exposes, offered as allowlist choices in settings. */
export const alphaVantageToolOptions = [
  ...defaultAlphaVantageTools,
  "TIME_SERIES_WEEKLY",
  "TIME_SERIES_MONTHLY",
  "REALTIME_BULK_QUOTES",
  "MARKET_STATUS",
  "IPO_CALENDAR",
  "INSTITUTIONAL_HOLDINGS",
  "SMA",
  "EMA",
  "RSI",
  "MACD",
  "HISTORICAL_OPTIONS",
  "INFLATION",
  "UNEMPLOYMENT",
  "RETAIL_SALES",
  "ANALYTICS_FIXED_WINDOW",
];

type Cfg = Record<string, unknown>;

/** Zero turns the cache off; a negative or unreadable TTL is ignored. */
function cacheTtlSeconds(cfg: Cfg): number {
  const ttl = settingNumber(cfg, "cacheTtlSeconds");
  return ttl !== undefined && ttl >= 0 ? ttl : DEFAULT_CACHE_TTL_SECONDS;
}

/**
 * Alpha Vantage runs an official MCP server, so the module is a preset for the generic
 * connector rather than a hand-written tool set. The settings page renders this read-only.
 */
export function alphaVantagePreset(cfg: Cfg): McpServerConfig {
  const allowTools = settingList(cfg, "allowTools", defaultAlphaVantageTools);
  return {
    id: ALPHA_VANTAGE_SOURCE_ID,
    name: ALPHA_VANTAGE_SOURCE_NAME,
    enabled: true,
    class: "data",
    tier: ALPHA_VANTAGE_TIER,
    coverage: alphaVantageServerCoverage(allowTools),
    transport: "http",
    url: `${MCP_URL}?apikey=${encodeURIComponent(settingString(cfg, "apiKey"))}`,
    allowTools,
    cacheTtlSeconds: cacheTtlSeconds(cfg),
  };
}

export const alphaVantageModule: Module = {
  id: "alphavantage",
  name: "Alpha Vantage",
  kind: "data-provider",
  description:
    "Quotes, price history, fundamentals, earnings history/calendar, transcripts and news via Alpha Vantage's official MCP server.",

  settings: [
    {
      key: "apiKey",
      label: "API key",
      type: "secret",
      required: true,
      help: "Get a free key at alphavantage.co/support/#api-key. Free tier: 25 requests/day. Open-source projects can request unlimited access on the same page.",
      helpUrl: "https://www.alphavantage.co/support/#api-key",
    },
    {
      key: "allowTools",
      label: "Tools",
      type: "multiselect",
      options: alphaVantageToolOptions.map((value) => ({ value, label: value })),
      help: "Tools exposed to the agent; keep the list short to save context and daily quota",
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
    allowTools: [...defaultAlphaVantageTools],
    cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
  },

  async validate(cfg) {
    const apiKey = settingString(cfg, "apiKey");
    if (!apiKey) return { ok: false, message: "Enter your Alpha Vantage API key." };
    try {
      const quote = await fetchQuote("IBM", apiKey);
      if (!quote) return { ok: false, message: "Alpha Vantage returned no quote for IBM." };
      return { ok: true, message: `Connected. IBM at ${quote.price} as of ${quote.asOf}.` };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  },

  async createTools(cfg, ctx): Promise<FinanceTool[]> {
    if (!settingString(cfg, "apiKey")) return [];
    return mcpServerTools(alphaVantagePreset(cfg), {
      include: (name) => !ctx.asOf || !alphaVantageIsCurrentOnly(name),
      meta: alphaVantageMeta,
      prepareArgs: preferJson,
      // Runs inside the cache loader, so a rate-limit body is never stored and never indexed.
      checkResult: assertNoProblem,
      rateLimit: RATE_LIMIT,
      // `ctx.asOf` is fixed for the turn, so the trimming closes over it; the cache holds raw text.
      postProcess: (toolName, args, body) => alphaVantagePostProcess(toolName, args, body, ctx.asOf),
    });
  },

  // No `quote` hook: Market Quotes prices the hover card for free, and every card priced here
  // would spend two calls of the 25 a day the free tier leaves for research.
  ui: {
    async searchSymbols(query, cfg): Promise<SymbolHit[]> {
      const apiKey = settingString(cfg, "apiKey");
      return apiKey ? searchSymbols(query, apiKey) : [];
    },
  },
};
