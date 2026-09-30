import { describe, expect, it } from "vitest";
import type { JsonObject } from "./asof";
import { alphaVantageDetails, MAX_TABLE_ROWS } from "./details";

const normalizeAlphaVantage = (args: Record<string, unknown>, payload: JsonObject, fn = "TEST") => alphaVantageDetails(fn, args, payload);

const daily: JsonObject = {
  "Meta Data": { "2. Symbol": "IBM" },
  "Time Series (Daily)": {
    "2025-06-27": { "1. open": "99.0", "2. high": "101.0", "3. low": "98.5", "4. close": "100.0", "5. volume": "1200" },
    "2025-06-30": { "1. open": "100.0", "2. high": "103.0", "3. low": "99.5", "4. close": "102.5", "5. volume": "3400" },
  },
};

describe("entity and asOf", () => {
  it("leaves the ticker the call names to the evidence normalizer, which reads the arguments", () => {
    expect(normalizeAlphaVantage({ symbol: "ibm" }, daily).details?.entity).toBeUndefined();
  });

  it("dates the result by the latest day it actually contains", () => {
    expect(normalizeAlphaVantage({}, daily).details?.asOf).toBe("2025-06-30");
  });

  it("dates report rows by their latest reported or fiscal date", () => {
    const earnings: JsonObject = {
      quarterlyEarnings: [{ fiscalDateEnding: "2025-03-31", reportedDate: "2025-04-23" }],
      annualEarnings: [{ fiscalDateEnding: "2024-12-31" }],
    };
    expect(normalizeAlphaVantage({ symbol: "IBM" }, earnings).details?.asOf).toBe("2025-04-23");
  });

  it("dates a quote by its latest trading day", () => {
    const quote: JsonObject = { "Global Quote": { "01. symbol": "IBM", "07. latest trading day": "2025-06-27" } };
    expect(normalizeAlphaVantage({ symbol: "IBM" }, quote).details?.asOf).toBe("2025-06-27");
  });

  it("describes a payload with no dates and no known shape by its function alone", () => {
    expect(normalizeAlphaVantage({}, { markets: [{ region: "US" }] }, "MARKET_STATUS").details).toEqual({ summary: "Alpha Vantage MARKET_STATUS" });
  });
});

describe("price table", () => {
  it("builds date, open, high, low, close, volume rows newest first", () => {
    const table = normalizeAlphaVantage({ symbol: "IBM" }, daily).details?.table;
    expect(table?.columns).toEqual(["date", "open", "high", "low", "close", "volume"]);
    expect(table?.index).toBe("date");
    expect(table?.rows).toEqual([
      ["2025-06-30", 100, 103, 99.5, 102.5, 3400],
      ["2025-06-27", 99, 101, 98.5, 100, 1200],
    ]);
  });

  it("reads an adjusted series by field name, not by column number", () => {
    const adjusted: JsonObject = {
      "Time Series (Daily)": {
        "2025-06-30": {
          "1. open": "100.0",
          "2. high": "103.0",
          "3. low": "99.5",
          "4. close": "102.5",
          "5. adjusted close": "102.1",
          "6. volume": "3400",
        },
      },
    };
    expect(normalizeAlphaVantage({}, adjusted).details?.table?.rows).toEqual([
      ["2025-06-30", 100, 103, 99.5, 102.5, 3400],
    ]);
  });

  it("indexes only the newest rows of a long series and says so", () => {
    const series: JsonObject = {};
    for (let day = 1; day <= 250; day++) {
      const date = new Date(Date.UTC(2025, 0, day)).toISOString().slice(0, 10);
      series[date] = { "1. open": "1", "2. high": "2", "3. low": "0.5", "4. close": "1.5", "5. volume": "10" };
    }
    const { details, notes } = normalizeAlphaVantage({}, { "Time Series (Daily)": series });
    expect(details?.table?.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(details?.table?.rows[0][0]).toBe("2025-09-07");
    expect(notes).toEqual(["Evidence table: the newest 200 of 250 rows were indexed."]);
  });

  it("leaves an indicator series without a table but still dates it", () => {
    const sma: JsonObject = { "Technical Analysis: SMA": { "2025-06-30": { SMA: "101.1" } } };
    const { details } = normalizeAlphaVantage({ symbol: "IBM" }, sma);
    expect(details?.table).toBeUndefined();
    expect(details?.asOf).toBe("2025-06-30");
  });
});

describe("macro table", () => {
  it("builds date, value rows newest first", () => {
    const cpi: JsonObject = {
      name: "Consumer Price Index",
      data: [
        { date: "2025-05-01", value: "322.0" },
        { date: "2025-06-01", value: "323.1" },
      ],
    };
    const table = normalizeAlphaVantage({}, cpi).details?.table;
    expect(table?.columns).toEqual(["date", "value"]);
    expect(table?.rows).toEqual([
      ["2025-06-01", 323.1],
      ["2025-05-01", 322],
    ]);
  });

  it("keeps a value it cannot parse as null rather than guessing", () => {
    const gaps: JsonObject = { data: [{ date: "2025-06-01", value: "." }] };
    expect(normalizeAlphaVantage({}, gaps).details?.table?.rows).toEqual([["2025-06-01", null]]);
  });

  it("builds no table when the rows are not a dated series", () => {
    const options: JsonObject = { data: [{ contractID: "IBM250718C00100000", date: "2025-06-30" }] };
    expect(normalizeAlphaVantage({}, options).details?.table).toBeUndefined();
  });
});

/* The shapes: what the ledger indexes from each allowlisted function. */

const shape = (fn: string, payload: JsonObject, args: Record<string, unknown> = { symbol: "NVDA" }) =>
  alphaVantageDetails(fn, args, payload).details;

describe("GLOBAL_QUOTE", () => {
  const details = shape("GLOBAL_QUOTE", {
    "Global Quote": {
      "01. symbol": "NVDA",
      "05. price": "125.6100",
      "06. volume": "348923455",
      "07. latest trading day": "2024-08-28",
      "08. previous close": "128.3000",
      "09. change": "-2.6900",
      "10. change percent": "-2.0966%",
    },
  });

  it("becomes facts for the latest trading day", () => {
    expect(details.summary).toBe("Alpha Vantage quote, $NVDA as of 2024-08-28");
    expect(details.asOf).toBe("2024-08-28");
    expect(details.entity).toEqual({ ticker: "NVDA" });
    expect(details.facts).toContainEqual({ metric: "price", period: "2024-08-28", value: 125.61, unit: "USD" });
    expect(details.facts).toContainEqual({ metric: "volume", period: "2024-08-28", value: 348_923_455, unit: "shares" });
    expect(details.facts).toContainEqual({ metric: "changePercent", period: "2024-08-28", value: -2.0966, unit: "%" });
  });
});

describe("time series", () => {
  it("takes the latest close as its one fact", () => {
    const details = shape("TIME_SERIES_DAILY", {
      "Time Series (Daily)": {
        "2024-08-28": { "1. open": "127.0", "2. high": "128.1", "3. low": "124.0", "4. close": "125.61", "5. volume": "348923455" },
        "2024-08-27": { "1. open": "129.0", "2. high": "129.5", "3. low": "126.5", "4. close": "128.30", "5. volume": "231000000" },
      },
    });
    expect(details.summary).toBe("Alpha Vantage TIME_SERIES_DAILY, $NVDA, 2 rows (latest 2024-08-28, close 125.61)");
    expect(details.facts).toEqual([{ metric: "close", period: "2024-08-28", value: 125.61, unit: "USD", end: "2024-08-28" }]);
    expect(details.numbers).toBeUndefined();
  });

  it("has nothing else worth sourcing when the newest row has no close", () => {
    const details = shape("TIME_SERIES_DAILY", { "Time Series (Daily)": { "2024-08-28": { "1. open": "127.0" } } });
    expect(details.facts).toBeUndefined();
    expect(details.numbers).toEqual([]);
  });
});

describe("fundamentals", () => {
  it("turns reports into a table and facts on canonical metric names", () => {
    const details = shape("INCOME_STATEMENT", {
      symbol: "NVDA",
      quarterlyReports: [
        { fiscalDateEnding: "2024-07-28", reportedCurrency: "USD", totalRevenue: "30040000000", grossProfit: "22574000000", netIncome: "16599000000" },
      ],
    });
    expect(details.table?.index).toBe("fiscalDateEnding");
    expect(details.table?.rows[0][0]).toBe("2024-07-28");
    expect(details.facts).toContainEqual({ metric: "revenue", period: "2024-07-28", periodType: "quarterly", value: 30_040_000_000, unit: "USD" });
    expect(details.asOf).toBe("2024-07-28");
  });

  it("reads earnings surprises", () => {
    const details = shape("EARNINGS", {
      symbol: "NVDA",
      quarterlyEarnings: [
        { fiscalDateEnding: "2024-07-28", reportedDate: "2024-08-28", reportedEPS: "0.68", estimatedEPS: "0.64", surprise: "0.04", surprisePercentage: "6.25" },
      ],
    });
    expect(details.asOf).toBe("2024-08-28");
    expect(details.facts).toContainEqual({ metric: "dilutedEps", period: "2024-07-28", periodType: "quarterly", value: 0.68, unit: "USD/share" });
    expect(details.facts).toContainEqual({ metric: "estimatedEps", period: "2024-07-28", periodType: "quarterly", value: 0.64, unit: "USD/share" });
    expect(details.facts).toContainEqual({ metric: "surprise", period: "2024-07-28", periodType: "quarterly", value: 0.04, unit: "USD/share" });
    expect(details.facts).toContainEqual({ metric: "surprisePercentage", period: "2024-07-28", periodType: "quarterly", value: 6.25, unit: "%" });
    expect(details.table?.columns).toContain("surprisePercentage");
  });

  it("keeps annual EPS distinct when quarterly earnings are absent", () => {
    const details = shape("EARNINGS", { symbol: "NVDA", annualEarnings: [{ fiscalDateEnding: "2024-07-28", reportedEPS: "2.75" }] });
    expect(details.facts).toEqual([{ metric: "dilutedEps", period: "2024-07-28", periodType: "annual", value: 2.75, unit: "USD/share" }]);
  });

  it("reads the overview's numeric fields", () => {
    const details = shape("COMPANY_OVERVIEW", {
      Symbol: "NVDA",
      Name: "NVIDIA Corporation",
      Currency: "USD",
      LatestQuarter: "2024-07-28",
      MarketCapitalization: "3090000000000",
      PERatio: "55.4",
      EPS: "1.87",
      DividendYield: "0.0002",
      Sector: "TECHNOLOGY",
    });
    expect(details.facts).toContainEqual({ metric: "marketCap", period: "2024-07-28", value: 3.09e12, unit: "USD" });
    expect(details.facts).toContainEqual({ metric: "peRatio", period: "2024-07-28", value: 55.4, unit: "ratio" });
    expect(details.facts).toContainEqual({ metric: "dividendYield", period: "2024-07-28", value: 0.0002, unit: "ratio" });
    // A text field contributes nothing.
    expect(details.facts?.some((fact) => fact.metric === "sector")).toBe(false);
    expect(details.entity).toEqual({ ticker: "NVDA", name: "NVIDIA Corporation" });
  });
});

describe("macro, news and funds", () => {
  it("turns a macro series into facts on its dates", () => {
    const details = shape(
      "TREASURY_YIELD",
      { name: "10-Year Treasury Constant Maturity Rate", unit: "percent", data: [{ date: "2024-09-18", value: "3.72" }, { date: "2024-09-17", value: "3.65" }] },
      {},
    );
    expect(details.asOf).toBe("2024-09-18");
    expect(details.unit).toBe("percent");
    expect(details.facts?.[0]).toMatchObject({ period: "2024-09-18", value: 3.72, unit: "percent" });
  });

  it("takes news numbers from headlines and summaries only", () => {
    const details = shape("NEWS_SENTIMENT", {
      items: "2",
      feed: [
        {
          title: "Nvidia beats with revenue of $30.04B",
          summary: "Data centre sales rose 154%.",
          time_published: "20240828T203000",
          overall_sentiment_score: 0.412_345,
          ticker_sentiment: [{ relevance_score: "0.998" }],
        },
      ],
    });
    expect(details.asOf).toBe("2024-08-28");
    const values = details.numbers?.map((number) => number.value) ?? [];
    expect(values).toContain(30_040_000_000);
    expect(values).toContain(154);
    // Sentiment and relevance scores are machine output, not figures a reader would quote.
    expect(values).not.toContain(0.412_345);
    expect(values).not.toContain(0.998);
  });

  it("reads an ETF profile and its holdings", () => {
    const details = shape(
      "ETF_PROFILE",
      {
        net_assets: "1104000000",
        net_expense_ratio: "0.0099",
        dividend_yield: "0.9812",
        holdings: [
          { symbol: "TSLA", description: "TESLA INC", weight: "0.4521" },
          { symbol: "CASH", description: "CASH", weight: "0.5479" },
        ],
      },
      { symbol: "TSLY" },
    );
    expect(details.facts).toContainEqual({ metric: "netAssets", period: "current", value: 1_104_000_000, unit: "USD" });
    expect(details.facts).toContainEqual({ metric: "netExpenseRatio", period: "current", value: 0.0099, unit: "ratio" });
    expect(details.table?.rows[0]).toEqual(["TSLA", "TESLA INC", 0.4521]);
    expect(details.summary).toBe("Alpha Vantage ETF_PROFILE, $TSLY, 2 holdings");
  });
});
