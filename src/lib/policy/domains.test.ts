import { describe, expect, it } from "vitest";
import { classifyQuery, extractCompany, knownEntities } from "./domains";
import { testLedger } from "./testing";

describe("classifyQuery", () => {
  it("reads the domain a query is after", () => {
    expect(classifyQuery("$NVDA Q3 earnings and EPS")).toContain("earnings");
    expect(classifyQuery("the 10-K risk factors")).toContain("filings");
    expect(classifyQuery("why did the stock fall today")).toContain("prices");
    expect(classifyQuery("$TSLY distribution and NAV")).toContain("funds");
    expect(classifyQuery("will the fed cut rates after the CPI print")).toContain("macro");
    expect(classifyQuery("data centre revenue and gross margin")).toContain("fundamentals");
    expect(classifyQuery("insider selling and 13F filings")).toContain("ownership");
    expect(classifyQuery("implied move from the options")).toContain("options");
    expect(classifyQuery("the earnings call transcript")).toContain("transcripts");
    expect(classifyQuery("what did they announce in the press release")).toContain("news");
    expect(classifyQuery("analyst consensus estimates")).toContain("estimates");
  });

  it("returns nothing for a query about none of them", () => {
    expect(classifyQuery("what does Jensen Huang think about robots")).toEqual([]);
  });
});

describe("extractCompany", () => {
  const known = { tickers: ["NVDA"], names: [{ name: "nvidia corporation", ticker: "NVDA" }] };

  it("prefers a cashtag", () => {
    expect(extractCompany("how is $TSLY doing", known)).toBe("TSLY");
  });

  it("takes a ticker the chat already knows", () => {
    expect(extractCompany("NVDA gross margin", known)).toBe("NVDA");
  });

  it("resolves a company name from the ledger", () => {
    expect(extractCompany("Nvidia Corporation revenue", known)).toBe("NVDA");
  });

  it("reads a company written without its legal suffix", () => {
    const filer = { tickers: ["NVDA"], names: [{ name: "nvidia corp", ticker: "NVDA" }, { name: "nvidia", ticker: "NVDA" }] };

    expect(extractCompany("Nvidia shares closed lower after earnings", filer)).toBe("NVDA");
  });

  it("will not read a name inside a longer word", () => {
    const filer = { tickers: [], names: [{ name: "apple", ticker: "AAPL" }] };

    expect(extractCompany("pineapple futures", filer)).toBeUndefined();
  });

  it("leaves a query about no company alone", () => {
    expect(extractCompany("will the fed cut rates", known)).toBeUndefined();
  });

  it("does not read a capitalised word as a ticker on its own", () => {
    expect(extractCompany("CPI and GDP prints", known)).toBeUndefined();
  });
});

describe("knownEntities", () => {
  it("keeps a filer name without its legal suffix beside the full one", () => {
    const ledger = testLedger();
    ledger.add({ kind: "E", summary: "filings", entity: { ticker: "NVDA", name: "NVIDIA CORP" } });

    expect(knownEntities(ledger, []).names).toEqual([
      { name: "nvidia corp", ticker: "NVDA" },
      { name: "nvidia", ticker: "NVDA" },
    ]);
  });

  it("joins the chat's tickers with the ledger's entities", () => {
    const ledger = testLedger();
    ledger.add({ kind: "E", summary: "profile", entity: { ticker: "amd", name: "Advanced Micro Devices" } });

    expect(knownEntities(ledger, ["NVDA"])).toEqual({
      tickers: ["NVDA", "AMD"],
      names: [{ name: "advanced micro devices", ticker: "AMD" }],
    });
  });
});
