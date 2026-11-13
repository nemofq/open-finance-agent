import { describe, expect, it } from "vitest";
import { asOfArgs, type JsonObject, type TrimOutcome, trimToAsOf } from "./asof";
import { fixtAccessions, incomeQuarterly, priceHistory } from "./responses.fixture";

type Row = JsonObject & { facts: JsonObject; sources: JsonObject; derived?: string[] };

function trimmed(outcome: TrimOutcome): unknown {
  if (outcome.kind !== "trimmed") throw new Error(`expected a trimmed payload, got ${outcome.kind}`);
  return outcome.payload;
}

const income = (asOf: string, args: JsonObject = { symbol: "FIXT", period: "quarter" }) =>
  trimToAsOf("financials_income_statement", args, incomeQuarterly, asOf);

describe("statement rows", () => {
  it("drops a period filed after the cutoff", () => {
    const rows = trimmed(income("2025-08-15")) as Row[];
    expect(rows.map((row) => row.period)).toEqual(["2025-06-30"]);
  });

  it("drops a value a later filing revised and keeps its siblings", () => {
    const [june] = trimmed(income("2025-08-15")) as Row[];
    expect(june.facts).not.toHaveProperty("revenue");
    expect(june.facts).toMatchObject({ netIncome: 120, eps: 0.6, epsDiluted: 0.59 });
    expect(Object.keys(june.sources)).toEqual([fixtAccessions.Q2_10Q]);
  });

  it("drops a derived line once any of its row's values was revised later", () => {
    const [june] = trimmed(income("2025-08-15")) as Row[];
    expect(june.facts).not.toHaveProperty("ebitda");
    expect(june.derived).toEqual([]);
  });

  it("counts the removed revisions in its note", () => {
    const outcome = income("2025-08-15");
    expect(outcome.kind === "trimmed" && outcome.notes).toEqual([
      "Point-in-time: trimmed to values filed on or before 2025-08-15.",
      "Removed 2 values that a filing after 2025-08-15 revised.",
    ]);
  });

  it("dates a reconstructed value from its row's filing", () => {
    // The September D&A comes from `Q3-Recon-9M-H1`, which has no filing date of its own.
    expect(income("2025-10-30")).toEqual({ kind: "unchanged", notes: [] });
  });

  it("leaves a response alone when everything in it predates the cutoff", () => {
    expect(income("2026-01-01")).toEqual({ kind: "unchanged", notes: [] });
  });

  it("drops a period with no filing date, which cannot be shown to predate the cutoff", () => {
    const undated = [{ ...incomeQuarterly[1], dateFiled: undefined }];
    expect(trimmed(trimToAsOf("financials_income_statement", {}, undated, "2026-01-01"))).toEqual([]);
  });

  it("withholds a trailing-twelve-month total", () => {
    const outcome = income("2025-08-15", { symbol: "FIXT", period: "TTM" });
    expect(outcome.kind).toBe("withheld");
    expect(outcome.kind === "withheld" && outcome.text).toContain("period=quarter");
  });
});

describe("price history", () => {
  it("cuts bars and the latest bar after the cutoff, keeping the cutoff day", () => {
    const payload = trimmed(trimToAsOf("price_history", {}, priceHistory, "2025-06-30")) as JsonObject;
    expect(payload.data).toEqual(priceHistory.data.slice(0, 2));
    expect(payload).not.toHaveProperty("latestQuote");
    expect(payload.symbol).toBe("FIXT");
  });

  it("says closes are restated even when nothing was cut", () => {
    const outcome = trimToAsOf("price_history", {}, priceHistory, "2025-12-31");
    expect(outcome.kind).toBe("unchanged");
    expect(outcome.kind === "unchanged" && outcome.notes).toHaveLength(1);
  });
});

describe("as-of arguments", () => {
  const statement = new Set(["symbol", "period", "limit", "splitAdjust"]);

  it("asks for values as filed from every tool that would otherwise split-adjust them", () => {
    expect(asOfArgs({ symbol: "FIXT", splitAdjust: true }, new Set(["symbol", "splitAdjust"]), "2025-06-30", "2025-07-01")).toEqual({ symbol: "FIXT", splitAdjust: false });
    expect(asOfArgs({ symbol: "FIXT" }, new Set(["symbol", "from", "to"]), "2025-06-30", "2025-07-01")).toEqual({ symbol: "FIXT" });
  });

  it("reaches back past the periods filed since the cutoff, which trimming removes", () => {
    // 494 days: six quarters or two years since the cutoff, plus one period of filing lag.
    expect(asOfArgs({ symbol: "FIXT", period: "quarter" }, statement, "2025-06-30", "2026-11-06").limit).toBe(11);
    expect(asOfArgs({ symbol: "FIXT", period: "annual" }, statement, "2025-06-30", "2026-11-06").limit).toBe(7);
    expect(asOfArgs({ symbol: "FIXT", period: "quarter", limit: 8 }, statement, "2025-06-30", "2026-11-06").limit).toBe(15);
  });

  it("never asks for more periods than the server accepts", () => {
    expect(asOfArgs({ symbol: "FIXT", period: "quarter" }, statement, "2001-03-31", "2026-11-06").limit).toBe(80);
  });
});

describe("other tools", () => {
  it("are returned as the server sent them", () => {
    expect(trimToAsOf("filings", {}, { data: [] }, "2025-06-30")).toEqual({ kind: "unchanged", notes: [] });
  });
});
