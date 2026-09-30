import { readConfig } from "@/lib/config/store";
import { portfolioDir } from "@/lib/paths";
import { getBatchQuotes, QuoteProviderError } from "@/lib/quotes/service";
import { quotesModule } from "@/lib/quotes/tool";
import type { LiveQuote } from "@/lib/quotes/types";
import { moduleEnabled } from "@/lib/tools/config";
import { type AccountCash, currentHoldings } from "./holdings";
import { createPortfolioStore } from "./store";
import { type Account, DEFAULT_PORTFOLIO_CURRENCY } from "./types";
import { evaluatePortfolio, type PortfolioValuation, type ValuedAccountHolding } from "./valuation";

/**
 * The Portfolio page's view of the ledger: the positions and cash it replays to, valued at live
 * prices. Not exported from `./index`, so the agent's `portfolio_get`, which never sees a price,
 * does not load the quote provider.
 */

export interface CurrentPortfolioQuery {
  /** The user's own date: the holdings are those on it. */
  today: string;
  /** A ticker (or a custom asset's name), matched case-insensitively. */
  symbol?: string;
  /** Skip the quote cache. */
  refresh?: boolean;
}

export interface CurrentPortfolio {
  asOf: string;
  holdings: ValuedAccountHolding[];
  cash: AccountCash[];
  valuation: PortfolioValuation;
  /** Why the holdings carry no live prices: the quote provider failed, or Market Quotes is off. */
  quoteError?: string;
}

/** What the page shows when the user has turned quotes off; it is their choice, not a failure. */
export const QUOTES_OFF_MESSAGE =
  "Market Quotes is off, so no live prices were fetched. Turn it on in Settings › Data connections";

/** The accounts' currency when every account shares one; the default otherwise. */
function valuationCurrency(accounts: Account[]): string {
  const currencies = new Set(accounts.map((account) => account.baseCurrency.trim().toUpperCase()).filter(Boolean));
  return currencies.size === 1 ? [...currencies][0] : DEFAULT_PORTFOLIO_CURRENCY;
}

interface LiveQuotes {
  quotes: Record<string, LiveQuote>;
  quoteError?: string;
}

/**
 * Fetching quotes sends every held symbol, never a quantity or a cost, to Yahoo Finance, so it
 * happens only while the Market Quotes module is on: a disabled module makes no calls.
 */
async function liveQuotes(symbols: string[], refresh: boolean): Promise<LiveQuotes> {
  if (symbols.length === 0) return { quotes: {} };
  if (!moduleEnabled(readConfig().modules, quotesModule)) return { quotes: {}, quoteError: QUOTES_OFF_MESSAGE };
  try {
    return { quotes: await getBatchQuotes(symbols, { refresh }) };
  } catch (error) {
    if (!(error instanceof QuoteProviderError)) throw error;
    return { quotes: {}, quoteError: error.message };
  }
}

/**
 * Holdings now. Quotes that are off or failed leave the valuation visibly incomplete, not an
 * error.
 */
export async function currentPortfolio(query: CurrentPortfolioQuery): Promise<CurrentPortfolio> {
  const store = createPortfolioStore(portfolioDir());
  const accounts = await store.listAccounts();
  const view = await currentHoldings(store, query.today, query.symbol);

  const symbols = view.holdings.map((holding) => holding.position.instrument.symbol).filter(Boolean);
  const { quotes, quoteError } = await liveQuotes(symbols, query.refresh === true);

  const valuation = evaluatePortfolio(view.holdings, view.cash, quotes, {
    asOf: view.asOf,
    currency: valuationCurrency(accounts),
  });

  return {
    asOf: view.asOf,
    holdings: valuation.holdings,
    cash: view.cash,
    valuation,
    ...(quoteError ? { quoteError } : {}),
  };
}
