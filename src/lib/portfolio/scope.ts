import type { AccountCash } from "./holdings";
import { valuationTotals, type PortfolioValuation, type ValuedAccountCash, type ValuedAccountHolding } from "./valuation";

/**
 * The portfolio screen's view of one valuation: narrowed to an account, and totalled by the
 * valuation's own arithmetic. Browser-safe: types from the ledger and pure functions, no I/O.
 */

/** `"all"` for every account, or the id of one. */
export type AccountScope = string;

export function scopeHoldings(holdings: ValuedAccountHolding[], scope: AccountScope): ValuedAccountHolding[] {
  return scope === "all" ? holdings : holdings.filter((item) => item.accountId === scope);
}

export function scopeCash<T extends AccountCash>(cash: T[], scope: AccountScope): T[] {
  return scope === "all" ? cash : cash.filter((item) => item.accountId === scope);
}

export interface ScopedTotals {
  totalCost: number | null;
  totalValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPercent: number | null;
  todayPnl: number | null;
  todayPercent: number | null;
  cashTotal: number | null;
  cashPercent: number | null;
  hasMissingQuote: boolean;
  complete: boolean;
  /** The valuation's currency, which every figure is in whichever account is scoped. */
  currency: string;
}

/**
 * Totals over the scoped holdings and cash, as `evaluatePortfolio` already valued them: in the
 * valuation's currency, and added up by the same `valuationTotals` that makes the portfolio's own
 * totals. A figure is `null` only where the valuation itself could not value a position or balance
 * it needs; a missing quote leaves the known market value standing. `currency` is the valuation's,
 * not a scoped account's: the totals carry the currency they were computed in as their label.
 */
export function scopedTotals(
  scoped: ValuedAccountHolding[],
  scopedCash: ValuedAccountCash[],
  currency: string,
): ScopedTotals {
  const totals = valuationTotals(scoped.map((item) => item.valuation), scopedCash.map((item) => item.value));
  const { totalCash, totalMarketValue } = totals;
  return {
    totalCost: totals.totalCostBasis,
    totalValue: totalMarketValue,
    unrealizedPnl: totals.totalUnrealizedPnl,
    unrealizedPercent: totals.totalUnrealizedPnlPercent,
    todayPnl: totals.todayPnl,
    todayPercent: totals.todayPnlPercent,
    cashTotal: totalCash,
    cashPercent: totalCash !== null && totalMarketValue !== null && totalMarketValue > 0 ? (totalCash / totalMarketValue) * 100 : null,
    hasMissingQuote: scoped.some((item) => item.valuation.status === "missing-quote"),
    complete: totals.complete,
    currency,
  };
}

export interface InstrumentTotals {
  /** The instrument's positions across every account. */
  positions: ValuedAccountHolding[];
  marketValue: number | null;
  costBasis: number | null;
  unrealizedPnl: number | null;
  unrealizedPercent: number | null;
}

/**
 * One ticker across the accounts that hold it, as the asset dialog shows it. A total is `null`
 * unless every position has the value; the valuation has already converted them to one currency.
 */
export function instrumentTotals(holdings: ValuedAccountHolding[], symbol: string | null): InstrumentTotals {
  const positions = symbol
    ? holdings.filter((item) => item.position.instrument.symbol.toUpperCase() === symbol.toUpperCase())
    : [];
  const costKnown = positions.length > 0 && positions.every((item) => typeof item.valuation?.costBasisValue === "number");
  const costBasis = costKnown ? positions.reduce((sum, item) => sum + (item.valuation.costBasisValue ?? 0), 0) : null;
  const valueKnown = positions.length > 0 && positions.every((item) => typeof item.valuation?.marketValue === "number");
  const marketValue = valueKnown ? positions.reduce((sum, item) => sum + (item.valuation.marketValue ?? 0), 0) : null;
  const unrealizedPnl = marketValue === null || costBasis === null ? null : marketValue - costBasis;
  const unrealizedPercent = unrealizedPnl === null || costBasis === null || costBasis <= 0 ? null : (unrealizedPnl / costBasis) * 100;
  return { positions, marketValue, costBasis, unrealizedPnl, unrealizedPercent };
}

/** What the page says above an incomplete valuation, or `""` when it is complete. */
export function valuationNotice(valuation: PortfolioValuation | undefined, quoteError: string | undefined): string {
  if (valuation?.complete !== false) return "";
  const parts = [
    quoteError,
    ...(valuation.missingQuotes?.length ? [`missing quotes: ${valuation.missingQuotes.join(", ")}`] : []),
    ...(valuation.missingFx?.length ? [`missing FX: ${valuation.missingFx.join(", ")}`] : []),
  ].filter((part): part is string => Boolean(part));
  return `Valuation incomplete — ${parts.join(" · ") || "some values are unavailable"}`;
}
