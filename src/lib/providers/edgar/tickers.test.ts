import { describe, expect, it } from "vitest";
import { lookupTicker, searchTickers, type TickerEntry } from "./tickers";

const map: TickerEntry[] = [
  { ticker: "AAPL", cik: "0000320193", name: "Apple Inc." },
  { ticker: "APP", cik: "0001751008", name: "AppLovin Corp" },
  { ticker: "APLE", cik: "0001418121", name: "Apple Hospitality REIT, Inc." },
  { ticker: "BRK-B", cik: "0001067983", name: "BERKSHIRE HATHAWAY INC" },
  { ticker: "MSFT", cik: "0000789019", name: "MICROSOFT CORP" },
];

describe("searchTickers", () => {
  it("ranks an exact ticker match above companies merely named that way", () => {
    // APP is the ticker; AAPL and APLE only match on company name, so they sort alphabetically.
    expect(searchTickers("app", map).map((hit) => hit.ticker)).toEqual(["APP", "AAPL", "APLE"]);
  });

  it("ranks a ticker prefix above a name match", () => {
    expect(searchTickers("ap", map).map((hit) => hit.ticker)).toEqual(["APP", "APLE", "AAPL"]);
  });

  it("puts ticker prefixes ahead of name matches", () => {
    expect(searchTickers("aapl", map)[0].ticker).toBe("AAPL");
  });

  it("matches company names case-insensitively", () => {
    expect(searchTickers("microsoft", map).map((hit) => hit.ticker)).toEqual(["MSFT"]);
  });

  it("accepts the dotted spelling of a class share", () => {
    expect(searchTickers("brk.b", map)[0].ticker).toBe("BRK-B");
  });

  it("returns nothing for an empty query and respects the limit", () => {
    expect(searchTickers("  ", map)).toEqual([]);
    expect(searchTickers("a", map, 2)).toHaveLength(2);
  });
});

describe("lookupTicker", () => {
  it("resolves exactly, ignoring case and dot notation", () => {
    expect(lookupTicker("brk.b", map)?.cik).toBe("0001067983");
    expect(lookupTicker("aapl", map)?.name).toBe("Apple Inc.");
  });

  it("returns null rather than a near miss", () => {
    expect(lookupTicker("APPL", map)).toBeNull();
  });
});
