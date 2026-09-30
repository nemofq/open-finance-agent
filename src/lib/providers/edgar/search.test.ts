import { describe, expect, it } from "vitest";
import { buildSearchUrl, capSearchToAsOf, type FilingHit, formatFilingHits } from "./search";

describe("buildSearchUrl", () => {
  it("quotes the phrase and percent-encodes spaces", () => {
    const url = buildSearchUrl({ query: "data center revenue" });
    // EFTS answers 500 when a space arrives as `+`.
    expect(url).toBe("https://efts.sec.gov/LATEST/search-index?q=%22data%20center%20revenue%22");
  });

  it("strips quotes the caller already added", () => {
    expect(buildSearchUrl({ query: '"guidance"' })).toContain("q=%22guidance%22");
  });

  it("adds the form filter and the custom date range together", () => {
    const url = buildSearchUrl({ query: "outlook", forms: ["8-K", "10-Q"], from: "2026-01-01", to: "2026-09-01" });
    expect(url).toContain("forms=8-K%2C10-Q");
    expect(url).toContain("dateRange=custom&startdt=2026-01-01&enddt=2026-09-01");
  });

  it("omits the date range when neither bound is given", () => {
    expect(buildSearchUrl({ query: "outlook" })).not.toContain("dateRange");
  });
});

describe("capSearchToAsOf", () => {
  it("leaves the request alone on a live turn", () => {
    const params = { query: "outlook", to: "2026-09-01" };
    expect(capSearchToAsOf(params, undefined)).toEqual({ params, capped: false });
  });

  it("bounds an open-ended search at the as-of date", () => {
    expect(capSearchToAsOf({ query: "outlook" }, "2025-06-30")).toEqual({
      params: { query: "outlook", to: "2025-06-30" },
      capped: true,
    });
  });

  it("pulls a later end date back and keeps the rest of the request", () => {
    expect(capSearchToAsOf({ query: "outlook", forms: ["8-K"], from: "2025-01-01", to: "2026-01-01" }, "2025-06-30")).toEqual({
      params: { query: "outlook", forms: ["8-K"], from: "2025-01-01", to: "2025-06-30" },
      capped: true,
    });
  });

  it("leaves an end date that is already inside the window", () => {
    const params = { query: "outlook", to: "2025-06-30" };
    expect(capSearchToAsOf(params, "2025-06-30")).toEqual({ params, capped: false });
    expect(capSearchToAsOf({ query: "outlook", to: "2024-01-01" }, "2025-06-30").capped).toBe(false);
  });
});

const hit: FilingHit = {
  entity: "NVIDIA CORP (NVDA) (CIK 0001045810)",
  cik: "0001045810",
  form: "8-K",
  fileType: "EX-99.1",
  filed: "2026-08-26",
  periodEnding: "2026-08-26",
  items: ["2.02", "9.01"],
  accession: "0001045810-26-000073",
  document: "q2fy27pr.htm",
  url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/q2fy27pr.htm",
  indexUrl: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/0001045810-26-000073-index.htm",
};

describe("formatFilingHits", () => {
  it("renders one row per hit with the document URL", () => {
    const text = formatFilingHits({ query: "outlook" }, { total: 41, hits: [hit] });
    expect(text).toContain("41 matching documents, showing 1");
    expect(text).toContain("| 8-K / EX-99.1 |");
    expect(text).toContain(hit.url);
  });

  it("says when the as-of date narrowed the search, and nothing when it did not", () => {
    const capped = formatFilingHits({ query: "outlook" }, { total: 1, hits: [hit] }, { cappedTo: "2026-08-31" });
    expect(capped).toContain("Point in time: the search was capped at 2026-08-31");
    expect(formatFilingHits({ query: "outlook" }, { total: 1, hits: [hit] })).not.toContain("Point in time");
  });

  it("explains an empty result rather than showing a bare table", () => {
    const text = formatFilingHits({ query: "zirconium", forms: ["8-K"] }, { total: 0, hits: [] });
    expect(text).toContain("found nothing");
    expect(text).toContain("2001");
  });
});
