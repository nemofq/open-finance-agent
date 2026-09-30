import { describe, expect, it } from "vitest";
import {
  filingsDetails,
  financialsDetails,
  lookupDetails,
  readFilingDetails,
  searchDetails,
  statementFacts,
} from "./evidence";
import { fixtureFacts } from "./facts.fixture";
import type { FilingHit } from "./search";
import { recentFilings, type Submissions } from "./submissions";
import { buildStatementData } from "./xbrl/statements";

const submissions: Submissions = {
  cik: "1045810",
  name: "NVIDIA CORP",
  tickers: ["NVDA"],
  filings: {
    recent: {
      accessionNumber: ["0001045810-26-000078", "0001045810-26-000073"],
      filingDate: ["2026-09-03", "2026-08-26"],
      reportDate: ["2026-09-02", "2026-08-26"],
      form: ["8-K", "8-K"],
      items: ["8.01", "2.02,9.01"],
      primaryDocument: ["nvda-20260902.htm", "nvda-20260826.htm"],
      primaryDocDescription: ["8-K", "8-K"],
    },
  },
};

describe("lookupDetails", () => {
  it("names the filer", () => {
    expect(lookupDetails("**NVIDIA CORP**\n- CIK: 0001045810", { ticker: "NVDA", submissions })).toEqual({
      summary: "SEC EDGAR — NVIDIA CORP",
      source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
      entity: { ticker: "NVDA", cik: "0001045810", name: "NVIDIA CORP" },
    });
  });

  it("still declares the source when nothing matched", () => {
    expect(lookupDetails("No SEC filer matches \"zzzz\".")).toEqual({
      summary: 'SEC EDGAR — No SEC filer matches "zzzz".',
      source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
    });
  });
});

describe("filingsDetails", () => {
  const details = filingsDetails("**NVIDIA CORP (NVDA) — 4 filings**\n\n| Form |", "NVDA", submissions, recentFilings(submissions));

  it("dates the result by the newest filing it returned and summarises it by its heading", () => {
    expect(details.asOf).toBe("2026-09-03");
    expect(details.summary).toBe("SEC EDGAR — NVIDIA CORP (NVDA) — 4 filings");
  });

  it("identifies the filer", () => {
    expect(details.entity).toEqual({ ticker: "NVDA", cik: "0001045810", name: "NVIDIA CORP" });
  });

  it("tabulates one row per filing", () => {
    expect(details.table?.columns).toEqual(["form", "filed", "reportDate", "accession", "url"]);
    expect(details.table?.rows[1]).toEqual([
      "8-K",
      "2026-08-26",
      "2026-08-26",
      "0001045810-26-000073",
      "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/nvda-20260826.htm",
    ]);
  });

  it("dates nothing when it found nothing", () => {
    expect(filingsDetails("No matching filings for NVDA.", "NVDA", submissions, []).asOf).toBeUndefined();
  });
});

describe("financialsDetails", () => {
  const statement = buildStatementData(fixtureFacts, "income", "annual", 3);
  const details = financialsDetails("FIX\n\n…", statement, { ticker: "FIX", cik: "1234567" });

  it("summarises the statement and dates it by its newest filing", () => {
    expect(details.summary).toBe("EDGAR income statement, annual, $FIX, 3 periods (latest 2025-12-31)");
    expect(details.asOf).toBe(statement.latestFiled);
    expect(details.facts?.every((fact) => fact.periodType === "annual")).toBe(true);
  });

  it("describes an empty statement by what the tool printed", () => {
    const empty = buildStatementData(fixtureFacts, "income", "annual", 3, { asOf: "2020-01-01" });
    const text = "FIX\n\nNo income statement facts found for Fixture Corp (annual).";
    expect(financialsDetails(text, empty, { ticker: "FIX", cik: "1234567" })).toMatchObject({ summary: "SEC EDGAR — FIX", facts: [] });
  });

  it("describes the subject, the periods and the currency", () => {
    expect(details.entity).toEqual({ ticker: "FIX", cik: "0001234567", name: "Fixture Corp" });
    expect(details.periods).toEqual(["2025-12-31", "2024-12-31", "2023-12-31"]);
    expect(details.unit).toBe("USD");
    expect(details.currency).toBe("USD");
    expect(details.statement).toBe("income");
  });

  it("is as of the newest filing behind the numbers", () => {
    expect(details.asOf).toBe(statement.latestFiled);
    expect(details.asOf).toBe("2026-02-15");
  });

  it("emits one fact per reported cell, in base units and backed by an accession", () => {
    expect(details.facts).toContainEqual({
      metric: "revenue",
      period: "2025-12-31",
      periodType: "annual",
      value: 1_200e6,
      unit: "USD",
      ref: "0000000000-25-000001",
      end: "2025-12-31",
    });
    expect(details.facts).toContainEqual({
      metric: "dilutedEps",
      period: "2024-12-31",
      periodType: "annual",
      value: 1.2,
      unit: "USD/share",
      ref: "0000000000-24-000001",
      end: "2024-12-31",
    });
  });

  it("labels every fact with a period the rendered table heads a column with", () => {
    for (const fact of details.facts ?? []) expect(statement.columns).toContain(fact.period);
  });

  it("retains measurement basis for flows and balance-sheet instants", () => {
    for (const period of ["annual", "quarterly"] as const) {
      for (const statement of ["income", "cashflow", "key_metrics", "balance"] as const) {
        const facts = statementFacts(buildStatementData(fixtureFacts, statement, period, 3));
        expect(facts.length).toBeGreaterThan(0);
        expect(new Set(facts.map((fact) => fact.periodType))).toEqual(new Set([statement === "balance" ? "instant" : period]));
      }
    }
  });

  it("says nothing about a period the filer left blank", () => {
    const shares = (details.facts ?? []).filter((fact) => fact.metric === "dilutedShares");
    expect(shares.map((fact) => fact.period)).toEqual(["2025-12-31", "2024-12-31"]);
  });

  it("keeps a computed margin in percent", () => {
    const metrics = buildStatementData(fixtureFacts, "key_metrics", "annual", 1);
    const [margin] = statementFacts(metrics).filter((fact) => fact.metric === "grossMargin");
    expect(margin.unit).toBe("%");
    expect(margin.value).toBeCloseTo(41.667, 3);
    expect(margin.ref).toBe("0000000000-25-000001");
  });

  it("tabulates the statement for the calculator, with a gap as null", () => {
    expect(details.table?.columns).toEqual(["metric", "2025-12-31", "2024-12-31", "2023-12-31"]);
    expect(details.table?.index).toBe("metric");
    expect(details.table?.rows[0]).toEqual(["revenue", 1_200e6, 1_000e6, 900e6]);
    expect(details.table?.rows.at(-1)).toEqual(["dilutedShares", 100e6, 100e6, null]);
  });
});

const hit: FilingHit = {
  entity: "NVIDIA CORP (NVDA)",
  cik: "0001045810",
  form: "8-K",
  fileType: "EX-99.1",
  filed: "2026-08-26",
  items: ["2.02"],
  accession: "0001045810-26-000073",
  document: "q2fy27pr.htm",
  url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/q2fy27pr.htm",
  indexUrl: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/0001045810-26-000073-index.htm",
};

describe("searchDetails", () => {
  it("dates the result by the newest hit and files it under the top hit's filer", () => {
    const details = searchDetails('EDGAR full-text search for "outlook" — 41 matching documents, showing 2.', { hits: [hit, { ...hit, filed: "2026-09-01" }] });
    expect(details).toEqual({
      summary: 'SEC EDGAR — EDGAR full-text search for "outlook" — 41 matching documents, showing 2.',
      asOf: "2026-09-01",
      entity: { cik: "0001045810" },
    });
  });

  it("dates nothing when nothing matched", () => {
    expect(searchDetails("EDGAR full-text search found nothing.", { hits: [] })).toEqual({
      summary: "SEC EDGAR — EDGAR full-text search found nothing.",
    });
  });
});

describe("readFilingDetails", () => {
  const url = "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/nvda-20260826.htm";

  it("carries the filer and the date the document is as of", () => {
    expect(readFilingDetails(url, { text: "…", cik: "0001045810", asOf: "2026-08-26" })).toEqual({
      summary: "SEC EDGAR — …",
      url,
      entity: { cik: "0001045810" },
      asOf: "2026-08-26",
      availableAt: "2026-08-26",
    });
  });

  it("invents neither when the URL yields neither", () => {
    expect(readFilingDetails("https://www.sec.gov/files/x.htm", { text: "…" })).toEqual({
      summary: "SEC EDGAR — …",
      url: "https://www.sec.gov/files/x.htm",
    });
  });

  it("takes a date the document states when the URL has none", () => {
    const text = "https://www.sec.gov/files/x.htm\n\nQ2 FY25 results (filed 2024-08-28)";
    expect(readFilingDetails("https://www.sec.gov/files/x.htm", { text }).asOf).toBe("2024-08-28");
  });
});
