import { describe, expect, it } from "vitest";
import { stockfitCoverage, stockfitMeta, stockfitServerCoverage } from "./meta";

describe("StockFit tool metadata", () => {
  it("files each tool under the domain it covers", () => {
    expect(stockfitCoverage("financials_income_statement")).toEqual(["fundamentals"]);
    expect(stockfitCoverage("footnotes_revenue_segmentation")).toEqual(["fundamentals"]);
    expect(stockfitCoverage("earnings_eps_history")).toEqual(["earnings"]);
    expect(stockfitCoverage("filings_item")).toEqual(["filings"]);
    expect(stockfitCoverage("ownership_institutional_holders")).toEqual(["ownership"]);
    expect(stockfitCoverage("insider_transactions")).toEqual(["ownership"]);
    expect(stockfitCoverage("fund_holdings")).toEqual(["funds"]);
    expect(stockfitCoverage("price_history")).toEqual(["prices"]);
    expect(stockfitCoverage("lookup_news")).toEqual(["news"]);
  });

  it("gives a tool it does not know a coverage, as every data tool must have one", () => {
    expect(stockfitCoverage("brand_new_tool")).toEqual(["fundamentals"]);
  });

  it("promises point-in-time results only for the tools it trims", () => {
    expect(stockfitMeta("financials_balance_sheet").supportsAsOf).toBe(true);
    expect(stockfitMeta("price_history").supportsAsOf).toBe(true);
    expect(stockfitMeta("earnings_eps_history").supportsAsOf).toBe(false);
    expect(stockfitMeta("filings")).toMatchObject({ class: "data", effect: "read", supportsAsOf: false, source: { id: "stockfit", tier: 2 } });
  });

  it("covers the union of the allowed tools' domains", () => {
    expect(stockfitServerCoverage(["financials_income_statement", "financials_balance_sheet", "price_history"])).toEqual(["fundamentals", "prices"]);
  });
});
