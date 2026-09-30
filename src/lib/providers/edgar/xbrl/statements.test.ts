import { describe, expect, it } from "vitest";
import { fixtureFacts } from "../facts.fixture";
import { renderStatement } from "./render";
import { buildStatementData } from "./statements";
import { buildStatement, columns, row } from "./testing";

describe("buildStatement — annual", () => {
  const table = buildStatement(fixtureFacts, "income", "annual", 8);

  it("puts the newest fiscal year first", () => {
    expect(columns(table)).toEqual(["2025-12-31", "2024-12-31", "2023-12-31"]);
  });

  it("reports money in millions with one decimal", () => {
    expect(row(table, "Revenue")).toEqual(["1,200.0", "1,000.0", "900.0"]);
  });

  it("prefers the first tag that has a value and falls back for years it misses", () => {
    // FY2024 is tagged both ways: the preferred tag's 1,000 wins over Revenues' 999.
    // FY2023 exists only under Revenues.
    expect(row(table, "Revenue")[1]).toBe("1,000.0");
    expect(row(table, "Revenue")[2]).toBe("900.0");
  });

  it("derives gross profit when the filer does not tag it", () => {
    expect(row(table, "Gross profit")).toEqual(["500.0", "400.0", "—"]);
  });

  it("shows EPS with two decimals and shares in millions", () => {
    expect(row(table, "Diluted EPS")).toEqual(["1.50", "1.20", "—"]);
    expect(row(table, "Diluted shares")).toEqual(["100.0", "100.0", "—"]);
  });

  it("ignores facts from non-periodic forms", () => {
    expect(table).not.toContain("9,999.0");
  });

  it("cites an accession number per column", () => {
    expect(table).toContain("Source: accession numbers per column");
    expect(table).toContain("2025-12-31: 0000000000-25-000001");
  });

  it("honours the period limit", () => {
    expect(columns(buildStatement(fixtureFacts, "income", "annual", 2))).toEqual([
      "2025-12-31",
      "2024-12-31",
    ]);
  });
});

describe("buildStatement — balance sheet", () => {
  it("uses instants at each fiscal year end", () => {
    const table = buildStatement(fixtureFacts, "balance", "annual", 8);
    expect(row(table, "Total assets")).toEqual(["2,000.0", "1,800.0", "—"]);
    expect(row(table, "Shareholders' equity")).toEqual(["800.0", "700.0", "—"]);
    expect(row(table, "Long-term debt")).toEqual(["500.0", "520.0", "—"]);
  });

  it("picks up quarter-end instants in the quarterly view", () => {
    const table = buildStatement(fixtureFacts, "balance", "quarterly", 4);
    expect(row(table, "Total assets")).toEqual(["2,000.0", "1,900.0", "—", "—"]);
  });
});

describe("buildStatement — cash flow", () => {
  it("derives free cash flow from operating cash flow and capex", () => {
    const table = buildStatement(fixtureFacts, "cashflow", "annual", 2);
    expect(row(table, "Operating cash flow")).toEqual(["250.0", "200.0"]);
    expect(row(table, "Capital expenditure")).toEqual(["50.0", "40.0"]);
    expect(row(table, "Free cash flow")).toEqual(["200.0", "160.0"]);
  });

  it("derives the fourth quarter of both inputs", () => {
    const table = buildStatement(fixtureFacts, "cashflow", "quarterly", 1);
    // Operating 250 − 175 = 75; capex 50 − 35 = 15.
    expect(row(table, "Free cash flow")).toEqual(["60.0"]);
  });
});

describe("buildStatement — key metrics", () => {
  const table = buildStatement(fixtureFacts, "key_metrics", "annual", 3);

  it("computes margins from the statement lines", () => {
    expect(row(table, "Gross margin")).toEqual(["41.7%", "40.0%", "—"]);
    expect(row(table, "Operating margin")).toEqual(["16.7%", "16.0%", "—"]);
    expect(row(table, "Net margin")).toEqual(["12.5%", "12.0%", "—"]);
  });

  it("computes year-on-year revenue growth against the prior period", () => {
    expect(row(table, "Revenue YoY")).toEqual(["20.0%", "11.1%", "—"]);
  });

  it("computes quarterly growth against the same quarter a year earlier", () => {
    const quarterly = buildStatement(fixtureFacts, "key_metrics", "quarterly", 4);
    // Q1 2025 revenue 250 against Q1 2024 revenue 200.
    expect(row(quarterly, "Revenue YoY")[3]).toBe("25.0%");
  });
});

describe("buildStatement — empty filers", () => {
  it("explains itself rather than returning an empty table", () => {
    const empty = { cik: 1, entityName: "Shell Co", facts: {} };
    expect(buildStatement(empty, "income", "annual", 4)).toContain("No income statement facts found");
  });
});

describe("buildStatementData", () => {
  const statement = buildStatementData(fixtureFacts, "income", "annual", 3);
  const line = (metric: string) => {
    const found = statement.rows.find((candidate) => candidate.metric === metric);
    if (!found) throw new Error(`no row ${metric}`);
    return found;
  };

  it("gives every line a stable metric id, whether reported or computed", () => {
    expect(statement.rows.map((row) => row.metric)).toEqual([
      "revenue",
      "costOfRevenue",
      "grossProfit",
      "operatingIncome",
      "netIncome",
      "dilutedEps",
      "dilutedShares",
    ]);
  });

  it("keeps values in base units beside the cell the table shows", () => {
    expect(line("revenue").unit).toBe("USD");
    expect(line("revenue").cells.map((cell) => cell.value)).toEqual([1_200e6, 1_000e6, 900e6]);
    expect(line("revenue").cells.map((cell) => cell.formatted)).toEqual(["1,200.0", "1,000.0", "900.0"]);
  });

  it("keeps EPS in dollars per share and shares in shares", () => {
    expect(line("dilutedEps").unit).toBe("USD/share");
    expect(line("dilutedEps").cells[0].value).toBe(1.5);
    expect(line("dilutedShares").unit).toBe("shares");
    expect(line("dilutedShares").cells[0].value).toBe(100e6);
  });

  it("keeps margins and growth in percent", () => {
    const metrics = buildStatementData(fixtureFacts, "key_metrics", "annual", 1);
    const gross = metrics.rows.find((row) => row.metric === "grossMargin");
    expect(gross?.unit).toBe("%");
    expect(gross?.cells[0].value).toBeCloseTo(41.667, 3);
    expect(gross?.cells[0].formatted).toBe("41.7%");
  });

  it("cites the accession behind each cell and leaves a gap empty", () => {
    expect(line("revenue").cells[0].accession).toBe("0000000000-25-000001");
    expect(line("dilutedShares").cells[2]).toEqual({ formatted: "—" });
  });

  it("flags a reconstructed fourth quarter on the cell itself", () => {
    const quarterly = buildStatementData(fixtureFacts, "income", "quarterly", 2);
    expect(quarterly.rows[0].cells[0]).toMatchObject({ derivation: "fourthQuarter", accession: "0000000000-25-000001" });
    expect(quarterly.rows[0].cells[1].derivation).toBeUndefined();
  });

  it("labels its columns exactly as the rendered table heads them", () => {
    expect(statement.columns).toEqual(columns(renderStatement(statement)));
  });

  it("reports the newest filing date behind the numbers", () => {
    expect(statement.latestFiled).toBe("2026-02-15");
  });
});
