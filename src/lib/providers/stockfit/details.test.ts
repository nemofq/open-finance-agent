import { describe, expect, it } from "vitest";
import { canonicalMetric } from "@/lib/evidence/metrics";
import type { EvidenceFact } from "@/lib/evidence/types";
import { stockfitDetails, stockfitFactMetrics } from "./details";
import { balanceAnnual, fixtAccessions, incomeQuarterly, priceHistory } from "./responses.fixture";

const income = stockfitDetails("financials_income_statement", { symbol: "fixt", period: "quarter" }, incomeQuarterly).details;
const balance = stockfitDetails("financials_balance_sheet", { symbol: "FIXT", period: "annual" }, balanceAnnual).details;

function fact(facts: EvidenceFact[] | undefined, metric: string, period: string): EvidenceFact | undefined {
  return facts?.find((candidate) => candidate.metric === metric && candidate.period === period);
}

describe("statement facts", () => {
  it("name the filing that set each value", () => {
    expect(fact(income.facts, "revenue", "2025-06-30")).toMatchObject({ value: 1000, ref: fixtAccessions.Q3_10Q });
    expect(fact(income.facts, "netIncome", "2025-06-30")).toMatchObject({ value: 120, ref: fixtAccessions.Q2_10Q });
  });

  it("keep basic and diluted EPS apart, per share in the statement currency", () => {
    expect(fact(income.facts, "basicEps", "2025-09-30")).toMatchObject({ value: 0.75, unit: "USD/share", periodType: "quarterly" });
    expect(fact(income.facts, "dilutedEps", "2025-09-30")).toMatchObject({ value: 0.74, unit: "USD/share" });
    expect(fact(income.facts, "dilutedShares", "2025-09-30")).toMatchObject({ value: 203, unit: "shares" });
  });

  it("use names the cross-check reads as the same line, never as another", () => {
    for (const metric of Object.values(stockfitFactMetrics)) expect(canonicalMetric(metric)).toBe(metric);
  });

  it("mark balance sheet values as instants", () => {
    expect(fact(balance.facts, "equity", "2024-12-31")).toMatchObject({ value: 4000, unit: "USD", periodType: "instant" });
  });

  it("keep a value the server could not convert in its own currency", () => {
    expect(fact(balance.facts, "cash", "2024-12-31")).toMatchObject({ value: 700, unit: "EUR" });
  });

  it("take each value's currency from the server when values were asked for as reported", () => {
    const rows = [{ ...balanceAnnual[0], fx: { targetCurrency: "original", originalCurrencies: ["EUR"], rates: [], unconverted: { EUR: ["assets"] } } }];
    const { facts } = stockfitDetails("financials_balance_sheet", { symbol: "FIXT", currency: "original" }, rows).details;
    expect(fact(facts, "assets", "2024-12-31")).toMatchObject({ unit: "EUR" });
    expect(fact(facts, "liabilities", "2024-12-31")).toBeUndefined();
  });

  it("date the entry by its latest filing and keep every line in the table", () => {
    expect(income).toMatchObject({ asOf: "2025-10-30", availableAt: "2025-10-30", entity: { ticker: "FIXT" }, periods: ["2025-09-30", "2025-06-30"] });
    expect(income.table?.rows.map((row) => row[0])).toContain("depreciationAndAmortization");
  });
});

describe("price history", () => {
  it("indexes the latest adjusted close and the series newest first", () => {
    const { details } = stockfitDetails("price_history", { symbol: "FIXT" }, priceHistory);
    expect(details.facts).toEqual([{ metric: "adjustedClose", period: "2025-07-01", periodType: "instant", value: 101.5, unit: "USD", end: "2025-07-01" }]);
    expect(details.table?.rows[0]).toEqual(["2025-07-01", 101.5]);
    expect(details.asOf).toBe("2025-07-01");
  });

  it("calls a close a close only when it was asked for unadjusted", () => {
    const { details } = stockfitDetails("price_history", { symbol: "FIXT", adjusted: false }, priceHistory);
    expect(details.facts?.[0]?.metric).toBe("close");
  });
});

describe("other tools", () => {
  it("leave the numbers to the text", () => {
    const { details } = stockfitDetails("filings", { symbol: "FIXT" }, { data: [] });
    expect(details.facts).toBeUndefined();
    expect(details.numbers).toBeUndefined();
  });
});
