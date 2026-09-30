import { describe, expect, it } from "vitest";
import type { LiveQuote } from "@/lib/quotes/types";
import type { AccountCash, AccountHolding } from "./holdings";
import { instrumentTotals, scopeCash, scopedTotals, scopeHoldings, valuationNotice, type ScopedTotals } from "./scope";
import { evaluatePortfolio, type PortfolioValuation } from "./valuation";

const holding = (accountId: string, symbol: string, quantity: number, costBasis: number, currency = "USD"): AccountHolding => ({
  accountId,
  accountName: accountId,
  baseCurrency: currency,
  position: {
    accountId,
    instrument: { id: `inst-${symbol.toLowerCase()}`, symbol, currency, kind: "equity" },
    quantity,
    costBasis,
    averageCost: costBasis / quantity,
    lots: [],
  },
});

const cash = (accountId: string, amount: number, currency = "USD"): AccountCash => ({
  accountId,
  accountName: accountId,
  balance: { accountId, amount, currency },
});

const quote = (symbol: string, price: number, change: number, currency = "USD"): LiveQuote => ({
  symbol,
  price,
  previousClose: price - change,
  change,
  changePercent: (change / (price - change)) * 100,
  currency,
  asOf: "2026-09-15T20:00:00Z",
});

/** Two USD accounts: AAPL bought for 1,500 now worth 2,000 (+100 today), MSFT for 800 now 1,000 (-50). */
function twoAccounts() {
  return evaluatePortfolio(
    [holding("brokerage", "AAPL", 10, 1500), holding("ira", "MSFT", 4, 800), holding("ira", "AAPL", 2, 300)],
    [cash("brokerage", 500), cash("ira", 200)],
    { AAPL: quote("AAPL", 200, 10), MSFT: quote("MSFT", 250, -12.5) },
  );
}

/** What `evaluatePortfolio` itself reports, in the summary's terms: the answer the page must show. */
function evaluatorTotals(valuation: PortfolioValuation): ScopedTotals {
  const { totalCash, totalMarketValue } = valuation;
  return {
    totalCost: valuation.totalCostBasis,
    totalValue: totalMarketValue,
    unrealizedPnl: valuation.totalUnrealizedPnl,
    unrealizedPercent: valuation.totalUnrealizedPnlPercent,
    todayPnl: valuation.todayPnl,
    todayPercent: valuation.todayPnlPercent,
    cashTotal: totalCash,
    cashPercent: totalCash !== null && totalMarketValue !== null && totalMarketValue > 0 ? (totalCash / totalMarketValue) * 100 : null,
    hasMissingQuote: valuation.missingQuotes.length > 0,
    complete: valuation.complete,
    currency: valuation.currency,
  };
}

describe("account scope", () => {
  it("keeps every holding and balance for all accounts, and one account's for its id", () => {
    const { holdings, cash: balances } = twoAccounts();
    expect(scopeHoldings(holdings, "all")).toBe(holdings);
    expect(scopeCash(balances, "all")).toBe(balances);
    expect(scopeHoldings(holdings, "ira").map((item) => item.position.instrument.symbol)).toEqual(["MSFT", "AAPL"]);
    expect(scopeCash(balances, "ira").map((item) => item.balance.amount)).toEqual([200]);
    expect(scopeHoldings(holdings, "closed")).toEqual([]);
  });
});

describe("scopedTotals", () => {
  it("adds up holdings and cash across all accounts", () => {
    const valuation = twoAccounts();
    const { holdings, cash: balances } = valuation;
    const totals = scopedTotals(holdings, balances, valuation.currency);
    expect(totals).toEqual(evaluatorTotals(valuation));
    // Cost 1,500 + 800 + 300 + 700 cash; value 2,000 + 1,000 + 400 + 700 cash.
    expect(totals.totalCost).toBe(3300);
    expect(totals.totalValue).toBe(4100);
    expect(totals.unrealizedPnl).toBe(800);
    expect(totals.unrealizedPercent).toBeCloseTo((800 / 3300) * 100);
    // Today: +100 on 10 AAPL, -50 on 4 MSFT, +20 on 2 AAPL.
    expect(totals.todayPnl).toBe(70);
    expect(totals.todayPercent).toBeCloseTo((70 / (4100 - 70)) * 100);
    expect(totals.cashTotal).toBe(700);
    expect(totals.cashPercent).toBeCloseTo((700 / 4100) * 100);
    expect(totals.complete).toBe(true);
  });

  it("totals only the chosen account", () => {
    const { holdings, cash: balances, currency } = twoAccounts();
    const totals = scopedTotals(scopeHoldings(holdings, "ira"), scopeCash(balances, "ira"), currency);
    expect(totals.totalCost).toBe(1300);
    expect(totals.totalValue).toBe(1600);
    expect(totals.todayPnl).toBe(-30);
    expect(totals.cashTotal).toBe(200);
  });

  it("keeps the known value but withholds return and today when a quote is missing", () => {
    const valuation = evaluatePortfolio(
      [holding("brokerage", "AAPL", 10, 1500), holding("brokerage", "PRIVATE", 1, 1000)],
      [cash("brokerage", 500)],
      { AAPL: quote("AAPL", 200, 10) },
    );
    const totals = scopedTotals(valuation.holdings, valuation.cash, valuation.currency);
    expect(totals.hasMissingQuote).toBe(true);
    expect(totals.totalValue).toBe(2500);
    expect(totals.totalCost).toBe(3000);
    expect(totals.unrealizedPnl).toBeNull();
    expect(totals.unrealizedPercent).toBeNull();
    expect(totals.todayPnl).toBeNull();
    expect(totals.todayPercent).toBeNull();
    expect(totals.cashTotal).toBe(500);
    expect(totals.complete).toBe(false);
  });

  it("withholds the cash and the totals when another currency's cash has no rate", () => {
    const valuation = evaluatePortfolio([holding("brokerage", "AAPL", 10, 1500)], [cash("brokerage", 500), cash("brokerage", 100, "EUR")], {
      AAPL: quote("AAPL", 200, 10),
    });
    const totals = scopedTotals(valuation.holdings, valuation.cash, valuation.currency);
    expect(totals.cashTotal).toBeNull();
    expect(totals.cashPercent).toBeNull();
    expect(totals.totalValue).toBeNull();
    expect(totals.totalCost).toBeNull();
    expect(totals.complete).toBe(false);
    expect(totals).toEqual(evaluatorTotals(valuation));
  });

  it("withholds the totals when an FX rate is missing", () => {
    const valuation = evaluatePortfolio([holding("eu", "SAP", 2, 400, "EUR")], [], { SAP: quote("SAP", 220, 2, "EUR") });
    expect(valuation.holdings[0].valuation.status).toBe("missing-fx");
    const totals = scopedTotals(valuation.holdings, valuation.cash, valuation.currency);
    expect(totals.totalValue).toBeNull();
    expect(totals.totalCost).toBeNull();
    expect(totals.unrealizedPnl).toBeNull();
    expect(totals.hasMissingQuote).toBe(false);
    expect(totals).toEqual(evaluatorTotals(valuation));
  });

  it("keeps the cost basis when only a quote's currency has no rate", () => {
    // A USD account holding a line quoted in EUR: the cost converts, the market value cannot.
    const valuation = evaluatePortfolio(
      [holding("brokerage", "AAPL", 10, 1500), holding("brokerage", "SAP", 2, 400)],
      [cash("brokerage", 500)],
      { AAPL: quote("AAPL", 200, 10), SAP: quote("SAP", 220, 2, "EUR") },
    );
    const totals = scopedTotals(valuation.holdings, valuation.cash, valuation.currency);
    expect(totals.totalCost).toBe(2400);
    expect(totals.totalValue).toBeNull();
    expect(totals.unrealizedPnl).toBeNull();
    expect(totals.todayPnl).toBeNull();
    expect(totals.complete).toBe(false);
    expect(totals).toEqual(evaluatorTotals(valuation));
  });

  it("keeps the known value when an unquoted position's cost cannot be converted", () => {
    const valuation = evaluatePortfolio(
      [holding("brokerage", "AAPL", 10, 1500), holding("eu", "PRIVATE", 1, 1000, "EUR")],
      [cash("brokerage", 500)],
      { AAPL: quote("AAPL", 200, 10) },
    );
    const totals = scopedTotals(valuation.holdings, valuation.cash, valuation.currency);
    expect(totals.hasMissingQuote).toBe(true);
    expect(totals.totalValue).toBe(2500);
    expect(totals.totalCost).toBeNull();
    expect(totals.unrealizedPnl).toBeNull();
    expect(totals.complete).toBe(false);
    expect(totals).toEqual(evaluatorTotals(valuation));
  });

  it("reads a cash currency the way the valuation does", () => {
    const valuation = evaluatePortfolio([], [cash("brokerage", 500, "usd ")], {});
    const totals = scopedTotals(valuation.holdings, valuation.cash, valuation.currency);
    expect(totals).toMatchObject({ totalValue: 500, cashTotal: 500, complete: true });
    expect(totals).toEqual(evaluatorTotals(valuation));
  });

  it("gives an empty scope zero value, zero cash and no percentages", () => {
    const totals = scopedTotals([], [], "USD");
    expect(totals).toMatchObject({ totalValue: 0, totalCost: 0, unrealizedPnl: 0, unrealizedPercent: null, cashTotal: 0, cashPercent: null, complete: true });
  });
});

describe("instrumentTotals", () => {
  it("totals one ticker across the accounts that hold it, whatever its case", () => {
    const { holdings } = twoAccounts();
    const totals = instrumentTotals(holdings, "aapl");
    expect(totals.positions.map((item) => item.accountId)).toEqual(["brokerage", "ira"]);
    expect(totals.costBasis).toBe(1800);
    expect(totals.marketValue).toBe(2400);
    expect(totals.unrealizedPnl).toBe(600);
    expect(totals.unrealizedPercent).toBeCloseTo((600 / 1800) * 100);
  });

  it("has no totals for a name-only asset or a position without a price", () => {
    expect(instrumentTotals(twoAccounts().holdings, null)).toMatchObject({ positions: [], marketValue: null, costBasis: null });
    const valuation = evaluatePortfolio([holding("brokerage", "PRIVATE", 1, 1000)], [], {});
    const totals = instrumentTotals(valuation.holdings, "PRIVATE");
    expect(totals.costBasis).toBe(1000);
    expect(totals.marketValue).toBeNull();
    expect(totals.unrealizedPnl).toBeNull();
    expect(totals.unrealizedPercent).toBeNull();
  });
});

describe("valuationNotice", () => {
  it("says nothing about a complete valuation", () => {
    expect(valuationNotice(twoAccounts(), undefined)).toBe("");
    expect(valuationNotice(undefined, "Quotes are off")).toBe("");
  });

  it("names the missing quotes, the missing rates and the quote error", () => {
    const valuation = evaluatePortfolio(
      [holding("brokerage", "PRIVATE", 1, 1000), holding("eu", "SAP", 2, 400, "EUR")],
      [],
      { SAP: quote("SAP", 220, 2, "EUR") },
    );
    expect(valuationNotice(valuation, "Yahoo is rate limiting")).toBe(
      "Valuation incomplete — Yahoo is rate limiting · missing quotes: PRIVATE · missing FX: EUR/USD",
    );
    expect(valuationNotice({ ...valuation, missingQuotes: [], missingFx: [] }, undefined)).toBe(
      "Valuation incomplete — some values are unavailable",
    );
  });
});
