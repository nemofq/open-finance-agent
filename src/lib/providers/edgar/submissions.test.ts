import { describe, expect, it } from "vitest";
import { formatFilings, matchesForm, recentFilings, type Submissions } from "./submissions";

const submissions: Submissions = {
  cik: "0001045810",
  name: "NVIDIA CORP",
  tickers: ["NVDA"],
  exchanges: ["Nasdaq"],
  filings: {
    recent: {
      accessionNumber: ["0001045810-26-000078", "0001045810-26-000073", "0001045810-26-000070", "0001045810-26-000060"],
      filingDate: ["2026-09-03", "2026-08-26", "2026-08-27", "2026-07-02"],
      reportDate: ["2026-09-02", "2026-08-26", "2026-07-26", "2026-06-28"],
      form: ["8-K", "8-K", "10-Q/A", "4"],
      items: ["8.01", "2.02,9.01", "", ""],
      primaryDocument: ["nvda-20260902.htm", "nvda-20260826.htm", "nvda-20260726.htm", "form4.xml"],
      primaryDocDescription: ["8-K", "8-K", "10-Q", "FORM 4"],
    },
  },
};

describe("recentFilings", () => {
  it("returns every filing when no form filter is given", () => {
    expect(recentFilings(submissions)).toHaveLength(4);
  });

  it("filters by form and includes amendments of that form", () => {
    expect(recentFilings(submissions, { forms: ["10-Q"] }).map((f) => f.form)).toEqual(["10-Q/A"]);
    expect(recentFilings(submissions, { forms: ["8-k"] })).toHaveLength(2);
  });

  it("splits 8-K items and builds both document URLs", () => {
    const [filing] = recentFilings(submissions, { forms: ["8-K"], limit: 1 });
    expect(filing.items).toEqual(["8.01"]);
    expect(filing.url).toBe(
      "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm",
    );
    expect(filing.indexUrl).toBe(
      "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/0001045810-26-000078-index.htm",
    );
  });

  it("stops at the limit", () => {
    expect(recentFilings(submissions, { limit: 2 })).toHaveLength(2);
  });

  it("drops filings filed after the as-of date before the limit bites", () => {
    const filings = recentFilings(submissions, { limit: 2, asOf: "2026-08-27" });
    // The 2026-09-03 filing is gone, and the limit still returns a full page of two.
    expect(filings.map((filing) => filing.filed)).toEqual(["2026-08-26", "2026-08-27"]);
  });

  it("returns nothing when every filing postdates the as-of date", () => {
    expect(recentFilings(submissions, { asOf: "2020-01-01" })).toEqual([]);
  });

  it("survives a filer with no filings", () => {
    const bare = { ...submissions, filings: { recent: {} } } as unknown as Submissions;
    expect(recentFilings(bare)).toEqual([]);
  });
});

describe("matchesForm", () => {
  it("matches a requested form to its family", () => {
    expect(matchesForm("13F-HR", ["13F"])).toBe(true);
    expect(matchesForm("13F-HR/A", ["13F"])).toBe(true);
    expect(matchesForm("10-K/A", ["10-K"])).toBe(true);
    expect(matchesForm("8-K/A", ["8-k"])).toBe(true);
    expect(matchesForm("SC 13G/A", ["SC 13G"])).toBe(true);
    expect(matchesForm("10-K", [" 10-K "])).toBe(true);
  });

  it("never matches a bare prefix or a different form that shares one", () => {
    expect(matchesForm("13F-HR", ["13"])).toBe(false);
    expect(matchesForm("10-KT", ["10-K"])).toBe(false);
    expect(matchesForm("10-Q", ["10-K"])).toBe(false);
    expect(matchesForm("4", ["40-F"])).toBe(false);
    expect(matchesForm("40-F", ["4"])).toBe(false);
    expect(matchesForm("10-K", [""])).toBe(false);
  });

  it("keeps every form when none is requested", () => {
    expect(matchesForm("S-1", undefined)).toBe(true);
    expect(matchesForm("S-1", [])).toBe(true);
  });
});

describe("formatFilings", () => {
  it("points the model at Item 2.02 for earnings releases", () => {
    const text = formatFilings("NVDA", submissions, recentFilings(submissions, { forms: ["8-K"] }));
    expect(text).toContain("| 8-K | 2026-08-26 | 2026-08-26 | 2.02, 9.01 |");
    expect(text).toContain("Item 2.02");
  });

  it("says why an empty list may be empty", () => {
    expect(formatFilings("NVDA", submissions, [])).toContain("widen or drop the form filter");
  });

  it("names the as-of cutoff, and says nothing about it otherwise", () => {
    const filings = recentFilings(submissions, { asOf: "2026-08-27" });
    expect(formatFilings("NVDA", submissions, filings, { asOf: "2026-08-27" })).toContain(
      "Point in time: filings filed after 2026-08-27 are excluded.",
    );
    expect(formatFilings("NVDA", submissions, filings)).not.toContain("Point in time");
    expect(formatFilings("NVDA", submissions, [], { asOf: "2020-01-01" })).toContain("Point in time");
  });
});
