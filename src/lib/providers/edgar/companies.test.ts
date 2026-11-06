import { describe, expect, it } from "vitest";
import { companySearchUrl, parseCompanySearch, withoutLegalSuffix } from "./companies";
import { companyListHtml, noCompanyHtml, singleCompanyHtml } from "./companies.fixture";

describe("companySearchUrl", () => {
  it("searches every filer by name, trimmed", () => {
    const url = new URL(companySearchUrl("  QVC  "));
    expect(url.origin + url.pathname).toBe("https://www.sec.gov/cgi-bin/browse-edgar");
    expect(Object.fromEntries(url.searchParams)).toEqual({ action: "getcompany", company: "QVC", type: "", dateb: "", owner: "include", count: "40" });
  });
});

describe("parseCompanySearch", () => {
  it("reads every registrant of a result list, with its SIC when it has one", () => {
    expect(parseCompanySearch(companyListHtml)).toEqual([
      { cik: "0001787724", name: "QVC Deutschland GP, Inc." },
      { cik: "0001355096", name: "Old QVC Group, Inc.", sic: "5961" },
      { cik: "0001254699", name: "QVC Group, Inc.", sic: "5961" },
    ]);
  });

  it("reads a single company's own page, not its filings table", () => {
    expect(parseCompanySearch(singleCompanyHtml)).toEqual([{ cik: "0001355096", name: "Old QVC Group, Inc.", sic: "5961" }]);
  });

  it("finds nothing on a no-match page", () => {
    expect(parseCompanySearch(noCompanyHtml)).toEqual([]);
    expect(parseCompanySearch("<html>Service unavailable</html>")).toEqual([]);
  });
});

describe("withoutLegalSuffix", () => {
  it.each([
    ["Toyota Motor Credit Corporation", "Toyota Motor Credit"],
    ["Ford Motor Credit Company LLC", "Ford Motor Credit"],
    ["Florida Power & Light Company", "Florida Power & Light"],
    ["Apple Inc.", "Apple"],
    ["The Walt Disney Company", "Walt Disney"],
    ["Caterpillar Financial Services Corp.", "Caterpillar Financial Services"],
  ])("drops the legal form from %s", (name, short) => {
    expect(withoutLegalSuffix(name)).toBe(short);
  });

  it("keeps words that are part of the name", () => {
    expect(withoutLegalSuffix("QVC Group")).toBe("QVC Group");
    expect(withoutLegalSuffix("Coca-Cola")).toBe("Coca-Cola");
    expect(withoutLegalSuffix("Costco Wholesale")).toBe("Costco Wholesale");
  });
});
