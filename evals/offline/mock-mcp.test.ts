import { describe, expect, it } from "vitest";
import { MockMcpBridge } from "./mock-mcp-bridge";
import { loadDataset } from "./dataset";

const DB = loadDataset();
const APPLE_13F = "retail-09-narrative-factcheck-apple";
const Q1_2024_13F = "0000950123-24-005622";
const Q1_2024_TABLE = "https://www.sec.gov/Archives/edgar/data/1067983/000095012324005622/xslForm13F_X02/32398.xml";

function text(result: { content: unknown[] }): string {
  return String((result.content[0] as { text?: string }).text);
}

describe("mock EDGAR form filters", () => {
  it("matches a requested form to its sub-types and amendments, the way EDGAR users write forms", async () => {
    const bridge = new MockMcpBridge(DB, APPLE_13F);
    const listed = async (forms: string[]) => {
      const result = await bridge.call("edgar_filings", { ticker: "BRK.B", forms });
      const rows = ((result.details as { table?: { rows: string[][] } }).table?.rows ?? []);
      return { accessions: rows.map((row) => row[3]), forms: new Set(rows.map((row) => row[0])) };
    };

    const bare = await listed(["13F"]);
    expect(bare.accessions).toContain(Q1_2024_13F);
    expect(bare.forms).toEqual(new Set(["13F-HR", "13F-HR/A"]));
    expect((await listed(["13f-hr"])).accessions).toEqual(bare.accessions);
    // Asking for the amendment returns only amendments.
    expect((await listed(["13F-HR/A"])).forms).toEqual(new Set(["13F-HR/A"]));
    // A prefix that is not followed by "-" or "/" is a different form.
    const partial = await bridge.call("edgar_filings", { ticker: "BRK.B", forms: ["13"] });
    expect((partial.details as { empty?: boolean }).empty).toBe(true);

    const search = await bridge.call("edgar_search_filings", { query: "APPLE INC COM 037833100", forms: ["13F"], from: "2024-02-01" });
    expect((search.details as { urls: string[] }).urls).toContain(Q1_2024_TABLE);
    expect(bridge.audit().events.filter((event) => event.tool === "edgar_search_filings")).toEqual([]);
  });

  it("points a 13F listing at the captured information table, not only the cover page", async () => {
    const bridge = new MockMcpBridge(DB, APPLE_13F);
    const result = await bridge.call("edgar_filings", { ticker: "BRK.B", forms: ["13F-HR"] });
    const row = (result.details as { table: { rows: string[][] } }).table.rows.find((item) => item[3] === Q1_2024_13F);
    expect(row?.[4]).toMatch(/xslForm13F_X02\/primary_doc\.xml$/);
    expect(row?.[5]).toContain(`holdings in information table ${Q1_2024_TABLE}`);
    expect(text(result)).toContain(Q1_2024_TABLE);

    // Other forms keep the plain readable-body flag.
    const apple = await bridge.call("edgar_filings", { ticker: "AAPL", forms: ["8-K"] });
    for (const item of (apple.details as { table: { rows: string[][] } }).table.rows) expect(item[5]).not.toContain("information table");
  });

  it("reports a later match only when it would have matched the search, forms included", async () => {
    const search = async (args: Record<string, unknown>) => {
      const bridge = new MockMcpBridge(DB, APPLE_13F);
      const result = await bridge.call("edgar_search_filings", args);
      return { state: (result.details as { coverageState?: string }).coverageState, text: text(result) };
    };
    // Talen's 10-Q body is filed after the 2024-08-06 cutoff: a 10-Q search for it is future material.
    const later = await search({ query: "Susquehanna Amended Interconnection", forms: ["10-Q"] });
    expect(later.state).toBe("not_available_as_of");
    expect(later.text).toContain("Matching material exists only after 2024-08-06.");
    // No 13F carries that text at any date, so the same search restricted to 13F is a plain no-match.
    const wrongForm = await search({ query: "Susquehanna Amended Interconnection", forms: ["13F"] });
    expect(wrongForm.state).toBe("empty");
    expect(wrongForm.text).not.toContain("exists only after");
    // Sharing one word with a later body is not a match: every query token must be present.
    const oneWord = await search({ query: "Susquehanna zzqxv" });
    expect(oneWord.state).toBe("empty");
  });
});

describe("mock EDGAR share basis", () => {
  const NVDA_TASK = "retail-01-nvda-beat-and-drop";
  type Served = { facts: Array<{ metric: string; period: string; value: number }> };
  const served = async (db: typeof DB, taskId: string) => {
    const bridge = new MockMcpBridge(db, taskId);
    const result = await bridge.call("edgar_financials", { ticker: "NVDA", statement: "income", period: "quarterly", limit: 12 });
    const details = result.details as Served;
    const series = (metric: string) => new Map(details.facts.filter((fact) => fact.metric === metric).map((fact) => [fact.period, fact.value]));
    return { text: text(result), series };
  };

  it("serves NVIDIA's quarterly diluted EPS on one share basis at the retail-01 cutoff", async () => {
    const { text: rendered, series } = await served(DB, NVDA_TASK);
    const eps = series("dilutedEps");
    // Q2 FY25 is reported post-split; Q1 FY25 was filed pre-split (5.98) and is restated by the
    // 2024-06-10 10-for-1 split, as NVIDIA's own later filings restate it.
    expect(eps.get("2024-07-28")).toBe(0.67);
    expect(eps.get("2024-04-28")).toBeCloseTo(0.598, 6);
    expect(eps.get("2023-07-30")).toBe(0.25);
    // The derived fourth quarter (FY minus Q1..Q3) no longer mixes bases: 1.193 - 0.082 - 0.25 - 0.371.
    expect(eps.get("2024-01-28")).toBeCloseTo(0.49, 6);
    // No split discontinuity: share counts stay within a normal buyback/issuance range quarter to quarter.
    const shares = [...series("dilutedShares").entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
    expect(shares.length).toBeGreaterThanOrEqual(8);
    for (let index = 1; index < shares.length; index++) expect(shares[index] / shares[index - 1]).toBeGreaterThan(0.9);
    for (let index = 1; index < shares.length; index++) expect(shares[index] / shares[index - 1]).toBeLessThan(1.1);
    for (const value of eps.values()) expect(value).toBeLessThan(1);
    // Money amounts are as reported, and the restatement is disclosed.
    expect(series("revenue").get("2024-04-28")).toBe(26_044_000_000);
    expect(rendered).toContain("Share basis: per-share and share-count figures filed before the 2024-06-10 10-for-1 split");
  });

  it("serves the filings' own pre-split figures at a cutoff before the split", async () => {
    const scope = DB.scopes[NVDA_TASK];
    const early = { ...DB, scopes: { ...DB.scopes, [NVDA_TASK]: { ...scope, cutoff: "2024-06-05" } } };
    const { text: rendered, series } = await served(early, NVDA_TASK);
    expect(series("dilutedEps").get("2024-04-28")).toBe(5.98);
    expect(series("dilutedEps").has("2024-07-28")).toBe(false);
    expect(rendered).not.toContain("Share basis");
  });
});

describe("mock company overview share basis", () => {
  it("prices market capitalisation with a share count on the quote's basis", async () => {
    // At retail-05's cutoff the newest cover-page count (2.46B, filed 2024-05-29) predates the
    // 2024-06-10 split while the quote is post-split, so the unadjusted cap was 10x too small.
    const bridge = new MockMcpBridge(DB, "retail-05-intel-value-trap");
    const overview = JSON.parse(text(await bridge.call("alphavantage__COMPANY_OVERVIEW", { symbol: "NVDA" }))) as Record<string, unknown> & { _offline_benchmark: Record<string, unknown> };
    expect(overview.SharesOutstanding).toBe("24600000000");
    expect(Number(overview.MarketCapitalization)).toBeGreaterThan(2e12);
    expect(overview._offline_benchmark.sharesRestatedForSplits).toEqual([{ date: "2024-06-10", ratio: 10 }]);
  });
});
