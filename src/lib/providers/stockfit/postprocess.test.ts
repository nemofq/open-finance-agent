import { describe, expect, it } from "vitest";
import { stockfitPostProcess } from "./postprocess";
import { fixtureBody } from "./responses.fixture";

const income = fixtureBody("financials_income_statement") as string;
const args = { symbol: "FIXT", period: "quarter" };

describe("StockFit results", () => {
  it("reach the model untouched on a live turn", () => {
    expect(stockfitPostProcess("financials_income_statement", args, income).text).toBe(income);
  });

  it("are rewritten to what was filed by the cutoff, with the reason, on a historical turn", () => {
    const { text, details } = stockfitPostProcess("financials_income_statement", args, income, "2025-08-15");
    expect(text).not.toContain("2025-09-30");
    expect(text).toContain("Point-in-time: trimmed to values filed on or before 2025-08-15.");
    expect(details?.asOf).toBe("2025-07-30");
  });

  it("replace a withheld result entirely", () => {
    const { text, details } = stockfitPostProcess("financials_income_statement", { ...args, period: "ttm" }, income, "2025-08-15");
    expect(text).toMatch(/^Withheld:/);
    expect(details?.facts).toBeUndefined();
  });

  it("pass a body that is not JSON through with a summary", () => {
    expect(stockfitPostProcess("filings", args, "Server busy")).toEqual({ text: "Server busy", details: { summary: "StockFit filings, $FIXT" } });
  });
});
