import { describe, expect, it } from "vitest";
import { evaluatePortfolio } from "./valuation";
import type { AccountCash, AccountHolding } from "./holdings";
import type { LiveQuote } from "@/lib/quotes/types";

describe("evaluatePortfolio", () => {
  const mockHolding = (symbol: string, quantity: number, costBasis: number): AccountHolding => ({
    accountId: "acc-1",
    accountName: "Main",
    position: {
      accountId: "acc-1",
      instrument: {
        id: `inst-${symbol.toLowerCase()}`,
        symbol,
        name: `${symbol} Inc`,
        currency: "USD",
        kind: "equity",
      },
      quantity,
      costBasis,
      averageCost: quantity > 0 ? costBasis / quantity : 0,
      lots: [],
    },
  });

  const mockCash = (amount: number): AccountCash => ({
    accountId: "acc-1",
    accountName: "Main",
    balance: {
      accountId: "acc-1",
      amount,
      currency: "USD",
    },
  });

  it("calculates mark-to-market valuation with gains and cash", () => {
    const holdings = [
      mockHolding("AAPL", 10, 1500), // Cost $150/share
    ];
    const cash = [mockCash(500)];
    const quotes: Record<string, LiveQuote> = {
      AAPL: {
        symbol: "AAPL",
        price: 200, // Now $200/share -> $2000 value
        previousClose: 190,
        change: 10, // +$10/share
        changePercent: 5.26,
        currency: "USD",
        asOf: "2026-09-15T20:00:00Z",
      },
    };

    const result = evaluatePortfolio(holdings, cash, quotes);

    expect(result.totalEquityCost).toBe(1500);
    expect(result.totalCash).toBe(500);
    expect(result.totalCostBasis).toBe(2000);
    expect(result.totalEquityValue).toBe(2000);
    expect(result.totalMarketValue).toBe(2500);
    expect(result.totalUnrealizedPnl).toBe(500); // 2500 - 2000
    expect(result.totalUnrealizedPnlPercent).toBe(25); // 500 / 2000 * 100
    expect(result.todayPnl).toBe(100); // 10 shares * $10 change
    expect(result.holdings[0].valuation.marketValue).toBe(2000);
    expect(result.holdings[0].valuation.unrealizedPnl).toBe(500);
    expect(result.holdings[0].valuation.unrealizedPnlPercent).toBeCloseTo(33.33, 1);
    expect(result.holdings[0].valuation.weight).toBe((2000 / 2500) * 100); // 80%
    expect(result.holdings[0].valuation.hasLivePrice).toBe(true);
  });

  it("marks valuation incomplete when a live quote is missing", () => {
    const holdings = [mockHolding("AAPL", 5, 500), mockHolding("XYZ", 5, 500)];
    const quotes: Record<string, LiveQuote> = {
      AAPL: {
        symbol: "AAPL",
        price: 120,
        previousClose: 118,
        change: 2,
        changePercent: 1.69,
        currency: "USD",
        asOf: "2026-09-15T20:00:00Z",
      },
    };
    const result = evaluatePortfolio(holdings, [mockCash(200)], quotes);

    expect(result.holdings[1].valuation.hasLivePrice).toBe(false);
    expect(result.holdings[1].valuation.status).toBe("missing-quote");
    expect(result.holdings[1].valuation.currentPrice).toBeNull();
    expect(result.holdings[1].valuation.marketValue).toBeNull();
    expect(result.holdings[1].valuation.unrealizedPnl).toBeNull();
    expect(result.totalEquityValue).toBe(600);
    expect(result.totalCash).toBe(200);
    expect(result.totalMarketValue).toBe(800);
    expect(result.complete).toBe(false);
    expect(result.missingQuotes).toEqual(["XYZ"]);
  });

  it("does not sum foreign values without an FX rate", () => {
    const holding = { ...mockHolding("SAP", 2, 220), baseCurrency: "EUR" };
    const result = evaluatePortfolio(
      [holding],
      [],
      {
        SAP: {
          symbol: "SAP",
          price: 130,
          previousClose: 128,
          change: 2,
          changePercent: 1.56,
          currency: "EUR",
          asOf: "2026-09-15T20:00:00Z",
        },
      },
      { currency: "USD" },
    );

    expect(result.complete).toBe(false);
    expect(result.totalMarketValue).toBeNull();
    expect(result.missingFx).toContain("EUR/USD");
  });

  it("does not value a quote with non-finite market fields", () => {
    const result = evaluatePortfolio(
      [mockHolding("AAPL", 1, 100)],
      [],
      {
        AAPL: {
          symbol: "AAPL",
          price: 200,
          previousClose: 190,
          change: Number.NaN,
          changePercent: 5.26,
          currency: "USD",
          asOf: "2026-09-15T20:00:00Z",
        },
      },
    );

    expect(result.complete).toBe(false);
    expect(result.holdings[0].valuation.status).toBe("missing-quote");
    expect(result.holdings[0].valuation.marketValue).toBeNull();
  });
});
