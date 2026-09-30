import { describe, expect, it } from "vitest";
import { entityFromArgs } from "./text";

describe("entityFromArgs", () => {
  it("reads the ticker from whichever argument names one", () => {
    for (const key of ["ticker", "tickers", "symbol", "symbols"]) {
      expect(entityFromArgs({ [key]: key.endsWith("s") ? ["$nvda"] : "nvda" })).toEqual({ ticker: "NVDA" });
    }
  });

  it("prefers ticker, then tickers, then symbol, then symbols, as TICKER_ARGUMENTS lists them", () => {
    expect(entityFromArgs({ symbol: "AMD", tickers: ["NVDA"] })).toEqual({ ticker: "NVDA" });
    expect(entityFromArgs({ symbols: ["AMD"], ticker: "NVDA" })).toEqual({ ticker: "NVDA" });
  });

  it("keeps a CIK beside the ticker, and finds nothing in other arguments", () => {
    expect(entityFromArgs({ ticker: "NVDA", cik: "0001045810" })).toEqual({ ticker: "NVDA", cik: "0001045810" });
    expect(entityFromArgs({ query: "NVDA" })).toBeUndefined();
  });
});
