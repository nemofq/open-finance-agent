import { describe, expect, it } from "vitest";
import { alphaVantagePostProcess } from "./postprocess";

const daily = JSON.stringify({
  "Time Series (Daily)": {
    "2025-07-02": { "1. open": "1", "2. high": "2", "3. low": "0.5", "4. close": "1.5", "5. volume": "10" },
    "2025-06-30": { "1. open": "1", "2. high": "2", "3. low": "0.5", "4. close": "1.4", "5. volume": "20" },
  },
});

describe("alphaVantagePostProcess", () => {
  it("leaves the text alone on a live turn but still describes it", () => {
    const result = alphaVantagePostProcess("TIME_SERIES_DAILY", { symbol: "IBM" }, daily);
    expect(result.text).toBe(daily);
    expect(result.details).toMatchObject({
      summary: expect.stringMatching(/^Alpha Vantage TIME_SERIES_DAILY, \$IBM, /),
      asOf: "2025-07-02",
      table: expect.objectContaining({ columns: ["date", "open", "high", "low", "close", "volume"] }),
    });
  });

  it("re-serialises the trimmed payload and appends the cutoff note", () => {
    const result = alphaVantagePostProcess("TIME_SERIES_DAILY", { symbol: "IBM" }, daily, "2025-06-30");
    expect(result.text).toContain("2025-06-30");
    expect(result.text).not.toContain("2025-07-02");
    expect(result.text.endsWith("Point-in-time: trimmed to data on or before 2025-06-30.")).toBe(true);
    expect(result.details?.asOf).toBe("2025-06-30");
  });

  it("replaces a quote dated after the cutoff and describes it by its function alone", () => {
    const quote = JSON.stringify({ "Global Quote": { "01. symbol": "IBM", "07. latest trading day": "2025-07-02" } });
    const result = alphaVantagePostProcess("GLOBAL_QUOTE", { symbol: "IBM" }, quote, "2025-06-30");
    expect(result.text).toContain("Quote withheld");
    // No date, facts or numbers of the quote survive, so nothing marks the note as look-ahead.
    expect(result.details).toEqual({ summary: "Alpha Vantage GLOBAL_QUOTE, $IBM" });
  });

  it("passes a body that is neither JSON nor a dated table through untouched", () => {
    const prose = "IBM is covered by this endpoint.";
    expect(alphaVantagePostProcess("SYMBOL_SEARCH", { symbol: "IBM" }, prose)).toEqual({
      text: prose,
      details: { summary: "Alpha Vantage SYMBOL_SEARCH, $IBM" },
    });
  });
});

/** The shape that leaked 2026 prices into a 2024 task: the server answered CSV, not JSON. */
const dailyCsv = [
  "timestamp,open,high,low,close,volume",
  "2026-09-11,170.0,172.0,169.0,171.5,1000",
  "2024-08-29,120.0,122.0,119.0,121.5,2000",
  "2024-08-28,118.0,121.0,117.5,120.0,3000",
].join("\n");

describe("alphaVantagePostProcess — CSV bodies", () => {
  it("trims a CSV time series to the cutoff and says so", () => {
    const result = alphaVantagePostProcess("TIME_SERIES_DAILY", { symbol: "NVDA" }, dailyCsv, "2024-08-29");
    expect(result.text).not.toContain("2026-09-11");
    expect(result.text).toContain("2024-08-29,120.0");
    expect(result.text.endsWith("Point-in-time: trimmed to data on or before 2024-08-29.")).toBe(true);
  });

  it("dates the entry by the newest row it kept, and tables the rows", () => {
    const result = alphaVantagePostProcess("TIME_SERIES_DAILY", { symbol: "nvda" }, dailyCsv, "2024-08-29");
    expect(result.details?.asOf).toBe("2024-08-29");
    expect(result.details?.table).toEqual({
      columns: ["date", "open", "high", "low", "close", "volume"],
      index: "date",
      rows: [
        ["2024-08-29", 120, 122, 119, 121.5, 2000],
        ["2024-08-28", 118, 121, 117.5, 120, 3000],
      ],
    });
  });

  it("leaves a live turn's CSV byte-identical but still describes it", () => {
    const result = alphaVantagePostProcess("TIME_SERIES_DAILY", { symbol: "NVDA" }, dailyCsv);
    expect(result.text).toBe(dailyCsv);
    expect(result.details?.asOf).toBe("2026-09-11");
    expect(result.details?.table?.rows).toHaveLength(3);
  });

  it("trims the macro series CSV as `date, value`", () => {
    const csv = ["timestamp,value", "2026-09-11,4.10", "2024-08-29,3.90"].join("\n");
    const result = alphaVantagePostProcess("TREASURY_YIELD", {}, csv, "2024-08-29");
    expect(result.text).not.toContain("4.10");
    expect(result.details?.table).toEqual({
      columns: ["date", "value"],
      index: "date",
      rows: [["2024-08-29", 3.9]],
    });
  });

  it("keeps the forward calendar whole, with a table but no as-of date", () => {
    const csv = "symbol,name,reportDate\nIBM,International Business Machines,2026-10-23";
    const result = alphaVantagePostProcess("EARNINGS_CALENDAR", { symbol: "IBM" }, csv, "2026-09-11");
    expect(result.text).toContain(csv);
    expect(result.text).toContain("was not trimmed to 2026-09-11");
    // A scheduled date is not the date the data refers to, so it must not become the entry's as-of.
    expect(result.details?.asOf).toBeUndefined();
    expect(result.details?.table?.columns).toEqual(["symbol", "name", "date"]);
  });
});
