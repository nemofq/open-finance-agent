import type { LiveQuote } from "@/lib/quotes/types";
import type { AccountCash, AccountHolding } from "./holdings";
import { DEFAULT_PORTFOLIO_CURRENCY } from "./types";

export type ValuationStatus = "live" | "missing-quote" | "missing-fx";

export interface ValuedPosition {
  /** The quote's native currency. Null when no quote was returned. */
  currentPrice: number | null;
  /** True when a provider returned a valid quote, even if an FX conversion is still missing. */
  hasLivePrice: boolean;
  /** Values are converted to the portfolio valuation currency when an FX rate is available. */
  costBasisValue: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
  todayPnl: number | null;
  todayPnlPercent: number | null;
  weight: number | null;
  valuationCurrency: string;
  status: ValuationStatus;
}

export interface ValuedAccountHolding extends AccountHolding {
  valuation: ValuedPosition;
  quote: LiveQuote | null;
}

export interface ValuedAccountCash extends AccountCash {
  /** The balance in the valuation currency; null when no FX rate converts it. */
  value: number | null;
}

/** The figures a set of valued positions and cash balances add up to. */
export interface ValuationTotals {
  totalCostBasis: number | null;
  /** Known market value subtotal; positions without quotes are omitted. */
  totalMarketValue: number | null;
  totalCash: number | null;
  totalEquityCost: number | null;
  totalEquityValue: number | null;
  totalUnrealizedPnl: number | null;
  totalUnrealizedPnlPercent: number | null;
  todayPnl: number | null;
  todayPnlPercent: number | null;
  /** False when any holding quote, cash conversion or cost conversion is unavailable. */
  complete: boolean;
}

export interface PortfolioValuation extends ValuationTotals {
  asOf: string;
  currency: string;
  missingQuotes: string[];
  missingFx: string[];
  holdings: ValuedAccountHolding[];
  cash: ValuedAccountCash[];
}

export interface EvaluatePortfolioOptions {
  currency?: string;
  asOf?: string;
}

function currencyCode(value: string | undefined): string {
  return (value ?? DEFAULT_PORTFOLIO_CURRENCY).trim().toUpperCase();
}

/** No exchange rates are fetched, so only a figure already in the valuation currency converts. */
function fxRate(from: string, to: string): number | null {
  return currencyCode(from) === currencyCode(to) ? 1 : null;
}

/**
 * Add up positions and cash balances that `evaluatePortfolio` has already valued, whether all of
 * them or one account's. Nothing is converted here: a figure is null when a position or balance
 * it needs could not be valued. A missing quote is still a usable partial valuation: the position
 * is omitted from the known subtotal, while a missing FX rate makes the subtotal unsafe.
 */
export function valuationTotals(
  positions: Pick<ValuedPosition, "costBasisValue" | "marketValue" | "todayPnl" | "status">[],
  cashValues: (number | null)[],
): ValuationTotals {
  let totalEquityCost = 0;
  let totalEquityValue = 0;
  let totalCash = 0;
  let todayTotalEquityPnl = 0;
  let costComplete = true;
  let cashComplete = true;
  let equityComplete = true;
  let marketValueComplete = true;

  for (const value of cashValues) {
    if (value === null) cashComplete = false;
    else totalCash += value;
  }
  for (const position of positions) {
    if (position.costBasisValue === null) costComplete = false;
    else totalEquityCost += position.costBasisValue;
    if (position.status !== "live") equityComplete = false;
    if (position.status === "missing-fx") marketValueComplete = false;
    if (position.marketValue !== null) totalEquityValue += position.marketValue;
    if (position.todayPnl !== null) todayTotalEquityPnl += position.todayPnl;
  }

  const complete = costComplete && cashComplete && equityComplete;
  const totalCostBasis = costComplete && cashComplete ? totalEquityCost + totalCash : null;
  // Missing quotes are intentionally excluded from this known subtotal. Do not
  // report a number when an FX conversion is unavailable, since that would mix
  // currencies and imply a false total.
  const totalMarketValue = marketValueComplete && cashComplete ? totalEquityValue + totalCash : null;
  const totalUnrealizedPnl = complete && totalCostBasis !== null && totalMarketValue !== null
    ? totalMarketValue - totalCostBasis
    : null;
  const totalUnrealizedPnlPercent =
    totalUnrealizedPnl !== null && totalCostBasis !== null && totalCostBasis > 0
      ? (totalUnrealizedPnl / totalCostBasis) * 100
      : null;
  const todayPnl = complete ? todayTotalEquityPnl : null;
  const yesterdayTotalValue = totalMarketValue !== null ? totalMarketValue - todayTotalEquityPnl : null;
  const todayPnlPercent =
    todayPnl !== null && yesterdayTotalValue !== null && yesterdayTotalValue > 0
      ? (todayPnl / yesterdayTotalValue) * 100
      : null;

  return {
    totalCostBasis,
    totalMarketValue,
    totalCash: cashComplete ? totalCash : null,
    totalEquityCost: costComplete ? totalEquityCost : null,
    totalEquityValue: marketValueComplete ? totalEquityValue : null,
    totalUnrealizedPnl,
    totalUnrealizedPnlPercent,
    todayPnl,
    todayPnlPercent,
    complete,
  };
}

/**
 * Perform mark-to-market valuation and P&L calculation over holdings and cash balances.
 *
 * Missing quotes and FX rates are represented as nulls instead of cost-basis guesses. This keeps
 * an incomplete portfolio from looking like a fully valued one and lets the UI explain exactly
 * what is missing.
 */
export function evaluatePortfolio(
  holdings: AccountHolding[],
  cashBalances: AccountCash[],
  quotes: Record<string, LiveQuote>,
  options: EvaluatePortfolioOptions = {},
): PortfolioValuation {
  const currency = currencyCode(options.currency);
  const asOf = options.asOf ?? new Date().toISOString();
  const quoteBySymbol = new Map(
    Object.entries(quotes).map(([symbol, quote]) => [symbol.trim().toUpperCase(), quote]),
  );

  const missingQuotes = new Set<string>();
  const missingFx = new Set<string>();

  const valuedCash: ValuedAccountCash[] = cashBalances.map((cash) => {
    const rate = fxRate(cash.balance.currency, currency);
    if (rate === null) missingFx.add(`${currencyCode(cash.balance.currency)}/${currency}`);
    return { ...cash, value: rate === null ? null : cash.balance.amount * rate };
  });

  const intermediate = holdings.map((item) => {
    const symbol = item.position.instrument.symbol.toUpperCase();
    const quote = quoteBySymbol.get(symbol) ?? null;
    const hasLivePrice = Boolean(
      quote &&
        Number.isFinite(quote.price) &&
        Number.isFinite(quote.previousClose) &&
        Number.isFinite(quote.change) &&
        Number.isFinite(quote.changePercent) &&
        quote.currency?.trim(),
    );
    const accountCurrency = currencyCode(item.baseCurrency ?? item.position.instrument.currency);
    const costRate = fxRate(accountCurrency, currency);
    if (costRate === null) missingFx.add(`${accountCurrency}/${currency}`);

    let status: ValuationStatus = "live";
    let currentPrice: number | null = null;
    let marketValue: number | null = null;
    let unrealizedPnl: number | null = null;
    let unrealizedPnlPercent: number | null = null;
    let todayPnl: number | null = null;
    let todayPnlPercent: number | null = null;

    if (!hasLivePrice || !quote) {
      status = "missing-quote";
      missingQuotes.add(symbol);
    } else {
      currentPrice = quote.price;
      const quoteRate = fxRate(quote.currency, currency);
      if (quoteRate === null || costRate === null) {
        status = "missing-fx";
        missingFx.add(`${currencyCode(quote.currency)}/${currency}`);
      } else {
        marketValue = item.position.quantity * quote.price * quoteRate;
        const cost = item.position.costBasis * costRate;
        unrealizedPnl = marketValue - cost;
        unrealizedPnlPercent = cost > 0 ? (unrealizedPnl / cost) * 100 : 0;
        todayPnl = item.position.quantity * quote.change * quoteRate;
        todayPnlPercent = quote.changePercent;
      }
    }

    return {
      item,
      quote,
      hasLivePrice,
      currentPrice,
      costBasisValue: costRate === null ? null : item.position.costBasis * costRate,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPercent,
      todayPnl,
      todayPnlPercent,
      status,
    };
  });

  const totals = valuationTotals(intermediate, valuedCash.map((cash) => cash.value));
  const { complete, totalMarketValue } = totals;

  const valuedHoldings: ValuedAccountHolding[] = intermediate.map((entry) => {
    const weight = complete && entry.marketValue !== null && totalMarketValue !== null && totalMarketValue > 0
      ? (entry.marketValue / totalMarketValue) * 100
      : null;

    return {
      ...entry.item,
      quote: entry.quote,
      valuation: {
        currentPrice: entry.currentPrice,
        hasLivePrice: entry.hasLivePrice,
        costBasisValue: entry.costBasisValue,
        marketValue: entry.marketValue,
        unrealizedPnl: entry.unrealizedPnl,
        unrealizedPnlPercent: entry.unrealizedPnlPercent,
        todayPnl: entry.todayPnl,
        todayPnlPercent: entry.todayPnlPercent,
        weight,
        valuationCurrency: currency,
        status: entry.status,
      },
    };
  });

  return {
    asOf,
    currency,
    ...totals,
    missingQuotes: [...missingQuotes].sort(),
    missingFx: [...missingFx].sort(),
    holdings: valuedHoldings,
    cash: valuedCash,
  };
}
