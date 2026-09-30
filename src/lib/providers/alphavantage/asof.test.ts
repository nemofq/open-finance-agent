import { describe, expect, it } from "vitest";
import { type JsonObject, type TrimOutcome, trimToAsOf } from "./asof";

const ASOF = "2025-06-30";

/** The notes of an outcome that kept the payload. */
function notesOf(outcome: TrimOutcome): string[] {
  if (outcome.kind === "withheld") throw new Error("expected the payload to be kept");
  return outcome.notes;
}

/** The outcome as a trimmed payload, failing the test when nothing was trimmed. */
function trimmed(toolName: string, payload: JsonObject, asOf = ASOF): JsonObject {
  const outcome = trimToAsOf(toolName, payload, asOf);
  if (outcome.kind !== "trimmed") throw new Error(`expected a trimmed payload, got ${outcome.kind}`);
  return outcome.payload;
}

describe("date-keyed series", () => {
  const daily: JsonObject = {
    "Meta Data": { "1. Information": "Daily Prices", "3. Last Refreshed": "2025-07-02" },
    "Time Series (Daily)": {
      "2025-07-02": { "4. close": "102.0" },
      "2025-06-30": { "4. close": "100.0" },
      "2025-06-27": { "4. close": "99.0" },
    },
  };

  it("drops entries after the cutoff and keeps the cutoff day itself", () => {
    const series = trimmed("TIME_SERIES_DAILY", daily)["Time Series (Daily)"];
    expect(Object.keys(series as JsonObject)).toEqual(["2025-06-30", "2025-06-27"]);
  });

  it("leaves objects whose keys are not all dates alone", () => {
    expect(trimmed("TIME_SERIES_DAILY", daily)["Meta Data"]).toEqual(daily["Meta Data"]);
  });

  it("names the cutoff once", () => {
    const outcome = trimToAsOf("TIME_SERIES_DAILY", daily, ASOF);
    expect(notesOf(outcome)).toEqual(["Point-in-time: trimmed to data on or before 2025-06-30."]);
  });

  it("trims intraday keys and technical-indicator series by their day", () => {
    const sma: JsonObject = {
      "Technical Analysis: SMA": {
        "2025-06-30 19:55:00": { SMA: "101.1" },
        "2025-07-01 19:55:00": { SMA: "101.4" },
      },
    };
    expect(Object.keys(trimmed("SMA", sma)["Technical Analysis: SMA"] as JsonObject)).toEqual(["2025-06-30 19:55:00"]);
  });

  it("leaves a series that already ends before the cutoff untouched", () => {
    const early = { "Time Series (Daily)": { "2025-01-02": { "4. close": "1" } } };
    const outcome = trimToAsOf("TIME_SERIES_DAILY", early, ASOF);
    expect(outcome.kind).toBe("unchanged");
    expect(notesOf(outcome)).toEqual([]);
  });
});

describe("data rows", () => {
  it("drops macro rows dated after the cutoff", () => {
    const cpi: JsonObject = {
      name: "Consumer Price Index",
      data: [
        { date: "2025-07-01", value: "323.0" },
        { date: "2025-06-01", value: "322.0" },
      ],
    };
    expect(trimmed("CPI", cpi).data).toEqual([{ date: "2025-06-01", value: "322.0" }]);
  });

  it("drops insider trades by their transaction date", () => {
    const insider: JsonObject = {
      data: [
        { transaction_date: "2025-08-04", ticker: "IBM", shares: "100" },
        { transaction_date: "2025-05-04", ticker: "IBM", shares: "50" },
      ],
    };
    expect(trimmed("INSIDER_TRANSACTIONS", insider).data).toHaveLength(1);
  });

  it("keeps rows that carry no date, so an unfamiliar shape is not emptied", () => {
    const bulk: JsonObject = { data: [{ symbol: "IBM", close: "100" }] };
    expect(trimToAsOf("REALTIME_BULK_QUOTES", bulk, ASOF).kind).toBe("unchanged");
  });
});

describe("NEWS_SENTIMENT", () => {
  const news: JsonObject = {
    items: "3",
    feed: [
      { title: "after", time_published: "20250701T103000" },
      { title: "on the day", time_published: "20250630T235900" },
      { title: "undated" },
    ],
  };

  it("keeps only articles published on or before the cutoff and fixes the count", () => {
    const result = trimmed("NEWS_SENTIMENT", news);
    expect((result.feed as { title: string }[]).map((item) => item.title)).toEqual(["on the day"]);
    expect(result.items).toBe("1");
  });
});

describe("EARNINGS", () => {
  it("cuts quarters by their reported date and years by their fiscal end", () => {
    const earnings: JsonObject = {
      symbol: "IBM",
      annualEarnings: [{ fiscalDateEnding: "2025-12-31" }, { fiscalDateEnding: "2024-12-31" }],
      quarterlyEarnings: [
        { fiscalDateEnding: "2025-06-30", reportedDate: "2025-07-23" },
        { fiscalDateEnding: "2025-03-31", reportedDate: "2025-04-23" },
      ],
    };
    const result = trimmed("EARNINGS", earnings);
    expect(result.annualEarnings).toEqual([{ fiscalDateEnding: "2024-12-31" }]);
    expect(result.quarterlyEarnings).toEqual([{ fiscalDateEnding: "2025-03-31", reportedDate: "2025-04-23" }]);
  });

  it("leaves the forward calendar alone and says why", () => {
    const outcome = trimToAsOf("EARNINGS_CALENDAR", {}, ASOF);
    expect(outcome.kind).toBe("unchanged");
    expect(notesOf(outcome)).toEqual([
      "Point-in-time: EARNINGS_CALENDAR lists scheduled future dates and was not trimmed to 2025-06-30.",
    ]);
  });
});

describe("statements", () => {
  const income: JsonObject = {
    symbol: "IBM",
    annualReports: [{ fiscalDateEnding: "2025-12-31" }, { fiscalDateEnding: "2024-12-31" }],
    quarterlyReports: [{ fiscalDateEnding: "2025-03-31" }],
  };

  it("keeps reports whose period ended on or before the cutoff", () => {
    const result = trimmed("INCOME_STATEMENT", income);
    expect(result.annualReports).toEqual([{ fiscalDateEnding: "2024-12-31" }]);
    expect(result.quarterlyReports).toEqual([{ fiscalDateEnding: "2025-03-31" }]);
  });

  it("warns that a period end is not a filing date, even when nothing was dropped", () => {
    const outcome = trimToAsOf("CASH_FLOW", { annualReports: [{ fiscalDateEnding: "2024-12-31" }] }, ASOF);
    expect(outcome.kind).toBe("unchanged");
    expect(notesOf(outcome)).toEqual([
      "Filing dates are not part of this response: a report whose period ended on or before 2025-06-30 may have been filed after it.",
    ]);
  });
});

describe("GLOBAL_QUOTE", () => {
  const quote = (day: string): JsonObject => ({ "Global Quote": { "01. symbol": "IBM", "07. latest trading day": day } });

  it("passes a quote on or before the cutoff through", () => {
    expect(trimToAsOf("GLOBAL_QUOTE", quote("2025-06-27"), ASOF)).toEqual({ kind: "unchanged", notes: [] });
  });

  it("withholds a later quote and points at the daily series", () => {
    const outcome = trimToAsOf("GLOBAL_QUOTE", quote("2025-07-02"), ASOF);
    if (outcome.kind !== "withheld") throw new Error("expected the quote to be withheld");
    expect(outcome.text).toContain("dated 2025-07-02");
    expect(outcome.text).toContain("TIME_SERIES_DAILY");
  });

  it("withholds a quote that carries no trading day", () => {
    expect(trimToAsOf("GLOBAL_QUOTE", { "Global Quote": { "01. symbol": "IBM" } }, ASOF).kind).toBe("withheld");
  });

  it("leaves a response that holds no quote alone", () => {
    expect(trimToAsOf("GLOBAL_QUOTE", { Information: "rate limit" }, ASOF).kind).toBe("unchanged");
  });
});

describe("payloads we cannot read", () => {
  it("leaves a shape it does not recognise untouched", () => {
    expect(trimToAsOf("MARKET_STATUS", { markets: [{ region: "US", current_status: "open" }] }, ASOF)).toEqual({
      kind: "unchanged",
      notes: [],
    });
  });
});
