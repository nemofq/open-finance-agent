import { describe, expect, it } from "vitest";
import type { CompanyFacts, FactEntry } from "./metrics";
import { renderStatement } from "./render";
import { detectSplits } from "./splits";
import { buildStatementData } from "./statements";

describe("buildStatementData — share basis across a stock split", () => {
  /** One filing: a form, the date it went in, and the accession it carries. */
  const filings = {
    q1_24: { form: "10-Q", filed: "2024-04-30" },
    q2_24: { form: "10-Q", filed: "2024-07-30" },
    q3_24: { form: "10-Q", filed: "2024-10-30" },
    fy_24: { form: "10-K", filed: "2025-02-15" },
    q1_25: { form: "10-Q", filed: "2025-04-30" },
    // The first filing after the split in May 2025: it restates the comparative quarter.
    q2_25: { form: "10-Q", filed: "2025-07-30" },
  } as const;
  type FilingId = keyof typeof filings;
  const fact = (start: string, end: string, val: number, filing: FilingId, fp: string): FactEntry => ({
    start,
    end,
    val: Number(val.toPrecision(12)),
    accn: filing,
    fp,
    ...filings[filing],
  });

  /** Old-basis EPS per quarter and the year; 100 million shares throughout. */
  const eps = { q1_24: 1.0, q2_24: 1.1, q3_24: 1.2, fy_24: 4.8, q1_25: 1.3, q2_25: 1.4 };
  const periods = {
    q1_24: ["2024-01-01", "2024-03-31", "Q1"],
    q2_24: ["2024-04-01", "2024-06-30", "Q2"],
    q3_24: ["2024-07-01", "2024-09-30", "Q3"],
    fy_24: ["2024-01-01", "2024-12-31", "FY"],
    q1_25: ["2025-01-01", "2025-03-31", "Q1"],
    q2_25: ["2025-04-01", "2025-06-30", "Q2"],
  } as const;

  /**
   * A filer that splits its shares `ratio`-for-1 (a fraction for a reverse split) between the
   * Q1 and Q2 2025 10-Qs. The Q2 2025 10-Q reports its own quarter on the new basis and
   * re-reports Q2 2024 on it too; everything filed earlier is on the old basis.
   */
  function splitFacts(ratio: number, options: { tagRatio?: boolean; reReport?: boolean } = {}): CompanyFacts {
    const reReport = options.reReport ?? true;
    const perShare: FactEntry[] = [];
    const shares: FactEntry[] = [];
    const revenue: FactEntry[] = [];
    for (const id of Object.keys(periods) as (keyof typeof periods)[]) {
      const [start, end, fp] = periods[id];
      const after = id === "q2_25";
      perShare.push(fact(start, end, after ? eps[id] / ratio : eps[id], id, fp));
      shares.push(fact(start, end, after ? 100e6 * ratio : 100e6, id, fp));
      revenue.push(fact(start, end, id === "fy_24" ? 4_000e6 : 1_000e6, id, fp));
    }
    if (reReport) {
      const [start, end] = periods.q2_24;
      perShare.push(fact(start, end, eps.q2_24 / ratio, "q2_25", "Q2"));
      shares.push(fact(start, end, 100e6 * ratio, "q2_25", "Q2"));
      revenue.push(fact(start, end, 1_000e6, "q2_25", "Q2"));
    }
    const tagged: CompanyFacts["facts"]["us-gaap"] = options.tagRatio
      ? { StockholdersEquityNoteStockSplitConversionRatio1: { units: { pure: [fact("2025-05-01", "2025-05-31", ratio, "q2_25", "Q2")] } } }
      : {};
    return {
      cik: 1,
      entityName: "Split Corp",
      facts: {
        "us-gaap": {
          Revenues: { units: { USD: revenue } },
          EarningsPerShareDiluted: { units: { "USD/shares": perShare } },
          WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares } },
          ...tagged,
        },
      },
    };
  }

  const values = (statement: ReturnType<typeof buildStatementData>, metric: string) => {
    const found = statement.rows.find((candidate) => candidate.metric === metric);
    if (!found) throw new Error(`no row ${metric}`);
    return Object.fromEntries(statement.columns.map((end, index) => [end, found.cells[index].value]));
  };

  it("detects a 10-for-1 split from the tagged ratio, dated by its first filing", () => {
    expect(detectSplits(splitFacts(10, { tagRatio: true, reReport: false }))).toEqual([
      { effective: "2025-07-30", ratio: 10, detectedFrom: "ratioConcept" },
    ]);
    // The re-reports agree with the tag, so they add no second split.
    expect(detectSplits(splitFacts(10, { tagRatio: true }))).toHaveLength(1);
  });

  it("detects a split from re-reported comparatives alone", () => {
    expect(detectSplits(splitFacts(10))).toEqual([{ effective: "2025-07-30", ratio: 10, detectedFrom: "restatement" }]);
    expect(detectSplits(splitFacts(0.25))).toEqual([
      { effective: "2025-07-30", ratio: 0.25, detectedFrom: "restatement" },
    ]);
  });

  it("leaves a pre-split cutoff as reported and says nothing about a later split", () => {
    const statement = buildStatementData(splitFacts(10, { tagRatio: true }), "income", "quarterly", 8, {
      asOf: "2025-06-30",
    });
    expect(values(statement, "dilutedEps")).toMatchObject({ "2025-03-31": 1.3, "2024-06-30": 1.1, "2024-03-31": 1.0 });
    expect(values(statement, "dilutedShares")["2025-03-31"]).toBe(100e6);
    expect(statement.shareBasis).toBeUndefined();
    expect(renderStatement(statement)).not.toContain("Share basis");
  });

  it("puts every earlier quarter and share count on the post-split basis", () => {
    const statement = buildStatementData(splitFacts(10, { tagRatio: true }), "income", "quarterly", 8, {
      asOf: "2025-08-01",
    });
    expect(values(statement, "dilutedEps")).toMatchObject({
      "2025-06-30": 0.14,
      "2025-03-31": 0.13,
      "2024-09-30": 0.12,
      "2024-06-30": 0.11,
      "2024-03-31": 0.1,
    });
    for (const count of Object.values(values(statement, "dilutedShares")).filter((value) => value !== undefined)) {
      expect(count).toBe(1_000e6);
    }
    expect(statement.shareBasis).toEqual([{ effective: "2025-07-30", ratio: 10, detectedFrom: "ratioConcept" }]);
    expect(renderStatement(statement)).toContain(
      "Share basis: per-share and share-count facts filed before the 10-for-1 split first reported on 2025-07-30 (tagged split ratio) are restated to the basis in force on 2025-08-01",
    );
  });

  it("derives the fourth quarter from a year and quarters on one basis", () => {
    // Without the rule: 4.80 as filed − (1.00 + 0.11 + 1.20) = 2.49, a number no filing reported.
    for (const facts of [splitFacts(10, { tagRatio: true }), splitFacts(10)]) {
      const statement = buildStatementData(facts, "income", "quarterly", 8, { asOf: "2025-08-01" });
      expect(values(statement, "dilutedEps")["2024-12-31"]).toBeCloseTo(0.15, 10);
    }
    const before = buildStatementData(splitFacts(10), "income", "quarterly", 8, { asOf: "2025-06-30" });
    expect(values(before, "dilutedEps")["2024-12-31"]).toBeCloseTo(1.5, 10);
  });

  it("restates a reverse split the other way", () => {
    const statement = buildStatementData(splitFacts(0.25), "income", "quarterly", 8, { asOf: "2025-08-01" });
    expect(values(statement, "dilutedEps")["2025-03-31"]).toBeCloseTo(5.2, 10);
    expect(values(statement, "dilutedShares")["2025-03-31"]).toBe(25e6);
    expect(renderStatement(statement)).toContain("1-for-4 split first reported on 2025-07-30 (detected from restated comparatives)");
  });

  it("does not treat a restatement at a ratio that is not a whole multiple as a split", () => {
    // Q2 2024 re-reported at 2.5× fewer shares' worth of EPS, in both tags: a restatement, not a split.
    const facts = splitFacts(2.5);
    expect(detectSplits(facts)).toEqual([]);
    const statement = buildStatementData(facts, "income", "quarterly", 8, { asOf: "2025-08-01" });
    expect(values(statement, "dilutedEps")).toMatchObject({ "2025-03-31": 1.3, "2024-06-30": 0.44 });
    expect(statement.shareBasis).toBeUndefined();
  });

  it("leaves money lines as filed", () => {
    const before = buildStatementData(splitFacts(10, { tagRatio: true }), "income", "quarterly", 8, { asOf: "2025-06-30" });
    const after = buildStatementData(splitFacts(10, { tagRatio: true }), "income", "quarterly", 8, { asOf: "2025-08-01" });
    expect(values(after, "revenue")).toMatchObject({ "2025-03-31": 1_000e6, "2024-12-31": 1_000e6 });
    for (const end of before.columns) expect(values(after, "revenue")[end]).toBe(values(before, "revenue")[end]);
  });

  it("restates to today's basis when there is no cutoff", () => {
    const statement = buildStatementData(splitFacts(10), "income", "quarterly", 8);
    expect(values(statement, "dilutedEps")["2025-03-31"]).toBe(0.13);
    expect(renderStatement(statement)).toContain("restated to the basis in force today");
  });
});
