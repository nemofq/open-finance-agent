import { Type } from "typebox";
import { sourceRequest } from "@/lib/data/source-snapshot";
import type { StructuredDetails } from "@/lib/evidence/types";
import { quotesResult } from "@/lib/quotes/details";
import type { Quote } from "@/lib/tickers/types";
import type { FinanceTool, Module, ToolMeta } from "@/lib/tools/contracts";
import { getBatchProfiles, getBatchQuotes, normalizeSymbols, type QuoteLog } from "./service";
import type { LiveQuote } from "./types";

const parameters = Type.Object({
  symbols: Type.Array(Type.String(), {
    description: "Array of ticker symbols to quote (e.g. ['AAPL', 'MSFT', 'SPY', 'BRK.B', '0700.HK', 'BTC-USD']).",
  }),
});

const quotesMeta: ToolMeta = {
  class: "data",
  effect: "read",
  source: {
    id: "quotes",
    name: "Market Quotes",
    tier: 2,
    coverage: ["prices", "funds"],
  },
  supportsAsOf: false,
};

export function marketQuotesTool(log?: QuoteLog): FinanceTool<typeof parameters, StructuredDetails> {
  return {
    name: "market_quotes",
    label: "Market quotes & sector profiles",
    description:
      "Fetch live market prices, daily changes, and sector/industry classifications for one or more ticker symbols in a single batch. Use this for portfolio valuation, checking current stock prices, and calculating sector exposure. Fast, free, and does not consume Alpha Vantage quota.",
    parameters,
    meta: quotesMeta,
    async execute(_toolCallId, params) {
      const cleanSymbols = normalizeSymbols(params.symbols);

      if (cleanSymbols.length === 0) {
        return {
          content: [{ type: "text", text: "No symbols provided to quote." }],
          details: {},
        };
      }

      const [quotes, profiles] = await Promise.all([
        sourceRequest(
          { source: "yahoo-finance", operation: "quotes", args: { symbols: cleanSymbols } },
          () => getBatchQuotes(cleanSymbols, { log }),
        ),
        sourceRequest(
          { source: "yahoo-finance", operation: "profiles", args: { symbols: cleanSymbols } },
          () => getBatchProfiles(cleanSymbols, { log }),
        ),
      ]);

      // The result is registered as evidence by `afterTool`, like any data connection's.
      const { text, details } = quotesResult(cleanSymbols.map((symbol) => {
        const quote = quotes[symbol];
        const profile = profiles[symbol];
        return {
          symbol,
          price: quote?.price,
          changePercent: quote?.changePercent,
          currency: quote?.currency,
          asOf: quote?.asOf,
          sector: profile?.sector,
          industry: profile?.industry,
        };
      }));
      return { content: [{ type: "text", text }], details };
    },
  };
}

/** What the ticker hover card shows of a live quote. */
function cardQuote(quote: LiveQuote): Quote {
  return { symbol: quote.symbol, price: quote.price, change: quote.change, changePercent: quote.changePercent, volume: quote.volume, asOf: quote.asOf };
}

export const quotesModule: Module = {
  id: "quotes",
  name: "Market Quotes",
  kind: "data-provider",
  description:
    "Live quotes, daily price changes and sector profiles via Yahoo Finance. Free, zero config, and supports global tickers.",
  settings: [],
  defaultConfig: { enabled: true },
  async createTools(_cfg, ctx) {
    return [marketQuotesTool(ctx.log)];
  },
  ui: {
    // On by default and keyless, so this is what prices the hover card on a fresh install.
    async quote(symbol): Promise<Quote | null> {
      const [ticker] = normalizeSymbols([symbol]);
      if (!ticker) return null;
      const quote = (await getBatchQuotes([ticker]))[ticker];
      return quote ? cardQuote(quote) : null;
    },
  },
};
