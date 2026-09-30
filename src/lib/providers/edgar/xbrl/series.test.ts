import { describe, expect, it } from "vitest";
import { fixtureFacts } from "../facts.fixture";
import type { CompanyFacts, FactEntry } from "./metrics";
import { renderStatement } from "./render";
import { buildStatementData } from "./statements";
import { buildStatement, columns, row } from "./testing";

describe("buildStatement — quarterly", () => {
  const table = buildStatement(fixtureFacts, "income", "quarterly", 8);

  it("lists fiscal quarters newest first, including the fiscal year ends", () => {
    expect(columns(table)).toEqual([
      "2025-12-31",
      "2025-09-30",
      "2025-06-30",
      "2025-03-31",
      "2024-12-31",
      "2024-09-30",
      "2024-06-30",
      "2024-03-31",
    ]);
  });

  it("derives the missing fourth quarter as the year minus its first three", () => {
    // FY2025 revenue 1,200 − (250 + 270 + 300) = 380.
    expect(row(table, "Revenue")[0]).toBe("380.0");
  });

  it("keeps a fourth quarter the filer reported itself", () => {
    expect(row(table, "Revenue")[4]).toBe("330.0");
  });

  it("never treats a year-to-date fact as a quarter", () => {
    expect(row(table, "Revenue")[2]).toBe("270.0");
  });

  it("keeps the latest filed fact when a period is reported twice", () => {
    expect(row(table, "Revenue")[3]).toBe("250.0");
  });

  it("derives quarterly EPS but not a weighted average share count", () => {
    expect(row(table, "Diluted EPS")[0]).toBe("0.45");
    expect(row(table, "Diluted shares")[0]).toBe("—");
  });

  it("flags the derived column in the source line", () => {
    expect(table).toContain("2025-12-31: 0000000000-25-000001 (Q4 derived from FY − Q1..Q3)");
    expect(table).not.toContain("2025-09-30: 0000000000-25-000030 (Q4 derived");
  });
});

describe("buildStatement — point in time", () => {
  it("drops a restatement filed after the cutoff and brings back what the record then said", () => {
    const table = buildStatement(fixtureFacts, "income", "quarterly", 8, { asOf: "2025-04-01" });
    expect(columns(table)).toEqual([
      "2025-03-31",
      "2024-12-31",
      "2024-09-30",
      "2024-06-30",
      "2024-03-31",
    ]);
    // The 10-Q of 2025-04-30 restated Q1 to 250; on 2025-04-01 only the 999 filed in February existed.
    expect(row(table, "Revenue")[0]).toBe("999.0");
  });

  it("never leaks a fiscal year whose 10-K was filed after the cutoff", () => {
    const table = buildStatement(fixtureFacts, "income", "annual", 8, { asOf: "2025-06-30" });
    expect(columns(table)).toEqual(["2024-12-31", "2023-12-31"]);
  });

  it("names the cutoff in the text", () => {
    const table = buildStatement(fixtureFacts, "income", "annual", 8, { asOf: "2025-06-30" });
    expect(table).toContain("Point in time: facts filed after 2025-06-30 are excluded");
  });

  it("explains an empty table rather than looking like a filer with no XBRL", () => {
    const table = buildStatement(fixtureFacts, "income", "annual", 8, { asOf: "2000-01-01" });
    expect(table).toContain("No income statement facts found");
    expect(table).toContain("Point in time: facts filed after 2000-01-01 are excluded");
  });

  it("dates the statement by the newest filing it was allowed to see", () => {
    const statement = buildStatementData(fixtureFacts, "income", "annual", 8, { asOf: "2025-06-30" });
    expect(statement.latestFiled).toBe("2025-02-15");
  });

  it("renders exactly as a live run when no cutoff is set", () => {
    expect(buildStatement(fixtureFacts, "income", "annual", 8, {})).toBe(
      buildStatement(fixtureFacts, "income", "annual", 8),
    );
    expect(buildStatement(fixtureFacts, "income", "annual", 8)).not.toContain("Point in time");
  });
});

describe("buildStatementData — year-to-date cash flow", () => {
  /** A cash-flow fact as a 10-Q or 10-K files it: cumulative from the fiscal-year start. */
  const ytd = (start: string, end: string, val: number, accn: string, extra: Partial<FactEntry> = {}): FactEntry => ({
    start,
    end,
    val,
    accn,
    form: "10-Q",
    filed: `${end.slice(0, 4)}-${String(Number(end.slice(5, 7)) + 1).padStart(2, "0")}-15`,
    ...extra,
  });
  const annual = (start: string, end: string, val: number, accn: string): FactEntry =>
    ytd(start, end, val, accn, { form: "10-K", fp: "FY", filed: `${Number(end.slice(0, 4)) + 1}-02-15` });

  function cashFacts(operating: FactEntry[], capex: FactEntry[]): CompanyFacts {
    return {
      cik: 1,
      entityName: "Cumulative Corp",
      facts: {
        "us-gaap": {
          NetCashProvidedByUsedInOperatingActivities: { units: { USD: operating } },
          PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: capex } },
          // Discrete revenue quarters give every period a column, even where cash flow has a gap.
          Revenues: {
            units: {
              USD: ["2024", "2025"].flatMap((year) =>
                [["01-01", "03-31"], ["04-01", "06-30"], ["07-01", "09-30"]].map(([from, to]) =>
                  ytd(`${year}-${from}`, `${year}-${to}`, 1e9, `rev-${year}-${to}`),
                ),
              ),
            },
          },
        },
      },
    };
  }

  // FY2025 has every cumulative fact; FY2024 lacks the half-year operating figure and the Q1 capex.
  const operating2025 = [
    ytd("2025-01-01", "2025-03-31", 100e6, "q1-25"),
    ytd("2025-01-01", "2025-06-30", 250e6, "q2-25"),
    ytd("2025-01-01", "2025-09-30", 420e6, "q3-25"),
    annual("2025-01-01", "2025-12-31", 600e6, "fy-25"),
  ];
  const capex2025 = [
    ytd("2025-01-01", "2025-03-31", 20e6, "q1-25"),
    ytd("2025-01-01", "2025-06-30", 45e6, "q2-25"),
    ytd("2025-01-01", "2025-09-30", 75e6, "q3-25"),
    annual("2025-01-01", "2025-12-31", 100e6, "fy-25"),
    // A later filing measured from another start is not this fiscal year's half: never subtract across starts.
    ytd("2024-12-29", "2025-06-30", 999e6, "other-start", { filed: "2025-11-01" }),
  ];
  const operating2024 = [
    ytd("2024-01-01", "2024-03-31", 80e6, "q1-24"),
    ytd("2024-01-01", "2024-09-30", 330e6, "q3-24"),
    annual("2024-01-01", "2024-12-31", 480e6, "fy-24"),
  ];
  const capex2024 = [
    ytd("2024-01-01", "2024-06-30", 30e6, "q2-24"),
    ytd("2024-01-01", "2024-09-30", 52e6, "q3-24"),
  ];

  const statement = buildStatementData(
    cashFacts([...operating2025, ...operating2024], [...capex2025, ...capex2024]),
    "cashflow",
    "quarterly",
    8,
  );
  const cell = (metric: string, end: string) => {
    const found = statement.rows.find((candidate) => candidate.metric === metric);
    const index = statement.columns.indexOf(end);
    if (!found || index < 0) throw new Error(`no cell ${metric} ${end}`);
    return found.cells[index];
  };

  it("derives Q2 and Q3 as year to date minus the year to date a quarter earlier", () => {
    expect(cell("operatingCashFlow", "2025-06-30").value).toBe(150e6);
    expect(cell("operatingCashFlow", "2025-09-30").value).toBe(170e6);
    expect(cell("capex", "2025-06-30").value).toBe(25e6);
    expect(cell("capex", "2025-09-30").value).toBe(30e6);
    expect(cell("freeCashFlow", "2025-06-30").value).toBe(125e6);
  });

  it("keeps Q1 as filed and still reaches Q4 through FY minus Q1..Q3", () => {
    expect(cell("operatingCashFlow", "2025-03-31")).toMatchObject({ value: 100e6 });
    expect(cell("operatingCashFlow", "2025-03-31").derivation).toBeUndefined();
    expect(cell("operatingCashFlow", "2025-12-31")).toMatchObject({ value: 180e6, derivation: "fourthQuarter" });
    expect(cell("capex", "2025-12-31").value).toBe(25e6);
  });

  it("flags the derived quarters and cites the later year-to-date filing", () => {
    expect(cell("operatingCashFlow", "2025-06-30")).toMatchObject({ derivation: "yearToDate", accession: "q2-25" });
    expect(cell("freeCashFlow", "2025-06-30")).toMatchObject({ derivation: "yearToDate" });
    const table = renderStatement(statement);
    expect(table).toContain("2025-06-30: q2-25 (quarter derived as year-to-date − prior year-to-date)");
    expect(table).toContain("2025-03-31: q1-25;");
  });

  it("leaves a dash when the prior year to date is missing rather than subtracting an older one", () => {
    // 9M 2024 minus Q1 2024 would be two quarters, not Q3.
    expect(cell("operatingCashFlow", "2024-09-30")).toEqual({ formatted: "—" });
    // Capex 2024 has H1 but no Q1, so Q2 is unknown while Q3 is 52 − 30.
    expect(cell("capex", "2024-06-30")).toEqual({ formatted: "—" });
    expect(cell("capex", "2024-09-30").value).toBe(22e6);
  });

  it("falls back to FY minus nine months for a Q4 the quarter sum cannot reach", () => {
    expect(cell("operatingCashFlow", "2024-12-31")).toMatchObject({ value: 150e6, derivation: "yearToDate" });
  });

  it("prefers a same-filing pair over mixing in a later restatement of one side", () => {
    const restated = buildStatementData(
      cashFacts(
        [
          ...operating2025,
          // The Q2 10-Q carried Q1 year to date too; a later filing restated Q1 alone.
          ytd("2025-01-01", "2025-03-31", 100e6, "q2-25"),
          ytd("2025-01-01", "2025-03-31", 110e6, "restated", { filed: "2025-12-01" }),
        ],
        capex2025,
      ),
      "cashflow",
      "quarterly",
      8,
    );
    const operating = restated.rows[0];
    const at = (end: string) => operating.cells[restated.columns.indexOf(end)];
    expect(at("2025-03-31").value).toBe(110e6);
    // 250 − 100 from filing q2-25, not 250 − 110 across filings.
    expect(at("2025-06-30")).toMatchObject({ value: 150e6, accession: "q2-25" });
  });

  it("uses the latest filed pair with the same start when no filing holds both", () => {
    const amended = buildStatementData(
      cashFacts(
        [...operating2025, ytd("2025-01-01", "2025-06-30", 260e6, "q2-25-amended", { form: "10-Q/A", filed: "2025-09-01" })],
        capex2025,
      ),
      "cashflow",
      "quarterly",
      8,
    );
    const operating = amended.rows[0];
    expect(operating.cells[amended.columns.indexOf("2025-06-30")]).toMatchObject({
      value: 160e6,
      accession: "q2-25-amended",
    });
  });

  it("leaves income lines to the quarters the filer reports", () => {
    const income = buildStatementData(
      {
        cik: 1,
        entityName: "Cumulative Corp",
        facts: {
          "us-gaap": {
            Revenues: {
              units: {
                USD: [ytd("2025-01-01", "2025-03-31", 100e6, "q1-25"), ytd("2025-01-01", "2025-06-30", 250e6, "q2-25")],
              },
            },
          },
        },
      },
      "income",
      "quarterly",
      8,
    );
    expect(income.columns).toEqual(["2025-03-31"]);
  });
});
