import { describe, expect, it } from "vitest";
import { alphaVantageCoverage, alphaVantageMeta, alphaVantageServerCoverage, alphaVantageSupportsAsOf } from "./meta";

describe("alphaVantageCoverage", () => {
  it("maps each function to the domains it actually covers", () => {
    expect(alphaVantageCoverage("INCOME_STATEMENT")).toEqual(["fundamentals"]);
    expect(alphaVantageCoverage("EARNINGS")).toEqual(["earnings", "estimates"]);
    expect(alphaVantageCoverage("EARNINGS_CALL_TRANSCRIPT")).toEqual(["transcripts"]);
    expect(alphaVantageCoverage("NEWS_SENTIMENT")).toEqual(["news"]);
    expect(alphaVantageCoverage("INSTITUTIONAL_HOLDINGS")).toEqual(["ownership"]);
    expect(alphaVantageCoverage("TREASURY_YIELD")).toEqual(["macro"]);
    expect(alphaVantageCoverage("ETF_PROFILE")).toEqual(["funds"]);
    expect(alphaVantageCoverage("HISTORICAL_OPTIONS")).toEqual(["options"]);
  });

  it("treats price-like and unknown functions as price coverage", () => {
    for (const name of ["GLOBAL_QUOTE", "TIME_SERIES_WEEKLY_ADJUSTED", "SMA", "SYMBOL_SEARCH", "WHAT_IS_THIS"]) {
      expect(alphaVantageCoverage(name)).toEqual(["prices"]);
    }
  });
});

describe("alphaVantageSupportsAsOf", () => {
  it("claims point-in-time only for functions the trimming rewinds", () => {
    for (const name of ["TIME_SERIES_DAILY", "SMA", "NEWS_SENTIMENT", "EARNINGS", "CASH_FLOW", "CPI", "GLOBAL_QUOTE"]) {
      expect(alphaVantageSupportsAsOf(name)).toBe(true);
    }
  });

  it("does not claim it for live, forward-looking or undated functions", () => {
    for (const name of [
      "SYMBOL_SEARCH",
      "MARKET_STATUS",
      "TOP_GAINERS_LOSERS",
      "COMPANY_OVERVIEW",
      "ETF_PROFILE",
      "EARNINGS_CALENDAR",
      "IPO_CALENDAR",
      "REALTIME_BULK_QUOTES",
      "ANALYTICS_FIXED_WINDOW",
      "EARNINGS_CALL_TRANSCRIPT",
    ]) {
      expect(alphaVantageSupportsAsOf(name)).toBe(false);
    }
  });
});

describe("alphaVantageServerCoverage", () => {
  it("unions the domains of the tools the user allowed, without repeats", () => {
    expect(alphaVantageServerCoverage(["GLOBAL_QUOTE", "TIME_SERIES_DAILY", "CASH_FLOW", "CPI"])).toEqual([
      "prices",
      "fundamentals",
      "macro",
    ]);
  });
});

describe("alphaVantageMeta", () => {
  it("declares a tier 2 data tool with the function's own coverage", () => {
    expect(alphaVantageMeta("NEWS_SENTIMENT")).toEqual({
      class: "data",
      effect: "read",
      supportsAsOf: true,
      source: { id: "alphavantage", name: "Alpha Vantage", tier: 2, coverage: ["news"] },
    });
  });
});
