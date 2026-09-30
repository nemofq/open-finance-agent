import { describe, expect, it } from "vitest";
import { dataTool, generalTool, testContext, testLedger } from "../testing";
import { p1TrustedSourcesFirst } from "./trusted-sources";
import type { BeforeToolEvent } from "../events";

const alphaVantage = dataTool("alphavantage__ETF_PROFILE", {
  id: "alphavantage",
  name: "Alpha Vantage",
  tier: 2,
  coverage: ["funds"],
});
const edgar = dataTool("edgar_filings", {
  id: "edgar",
  name: "SEC EDGAR",
  tier: 1,
  coverage: ["filings"],
});
const search = generalTool("web_search");

function searchFor(query: string): BeforeToolEvent {
  return { stage: "before_tool", toolName: "web_search", toolCallId: "call_1", args: { query }, tool: search };
}

describe("P1 trusted sources first", () => {
  it("blocks a web search for a domain an untried connection covers", () => {
    const context = testContext({ tools: [alphaVantage, search] });
    const verdict = p1TrustedSourcesFirst(searchFor("$TSLY ETF distribution yield"), context);

    expect(verdict?.kind).toBe("block");
    expect(verdict?.reason).toContain("alphavantage__ETF_PROFILE");
    expect(verdict?.reason).toContain("Alpha Vantage, tier 2");
    expect(verdict?.reason).toContain("$TSLY");
    expect(verdict?.requires).toEqual(["alphavantage__ETF_PROFILE"]);
  });

  it("allows the search once that connection has been tried for the company", () => {
    const context = testContext({ tools: [alphaVantage, search] });
    context.state.connectionsTried.set("TSLY", new Set(["alphavantage"]));

    expect(p1TrustedSourcesFirst(searchFor("$TSLY ETF distribution yield"), context)).toBeUndefined();
  });

  it("lifts once the connection failed for that company", () => {
    const context = testContext({ tools: [alphaVantage, search] });
    context.state.connectionsFailed.set("TSLY", new Set(["alphavantage"]));

    expect(p1TrustedSourcesFirst(searchFor("$TSLY ETF distribution yield"), context)).toBeUndefined();
  });

  it("leaves a company alone when the tried connection was for another one", () => {
    const context = testContext({ tools: [alphaVantage, search] });
    context.state.connectionsTried.set("NVDA", new Set(["alphavantage"]));

    expect(p1TrustedSourcesFirst(searchFor("$TSLY ETF distribution yield"), context)?.kind).toBe("block");
  });

  it("allows a domain no enabled connection covers", () => {
    const context = testContext({ tools: [edgar, search] });

    expect(p1TrustedSourcesFirst(searchFor("$TSLY ETF distribution yield"), context)).toBeUndefined();
  });

  it("allows a query it cannot classify", () => {
    const context = testContext({ tools: [alphaVantage, edgar, search] });

    expect(p1TrustedSourcesFirst(searchFor("what does Jensen Huang think about robots"), context)).toBeUndefined();
  });

  it("checks the domain only for a macro query with no company", () => {
    const rates = dataTool("alphavantage__FEDERAL_FUNDS_RATE", {
      id: "alphavantage",
      name: "Alpha Vantage",
      tier: 2,
      coverage: ["macro"],
    });
    const context = testContext({ tools: [rates, search] });
    const verdict = p1TrustedSourcesFirst(searchFor("will the fed cut rates in October"), context);

    expect(verdict?.kind).toBe("block");
    expect(verdict?.reason).toContain("alphavantage__FEDERAL_FUNDS_RATE");
    expect(verdict?.reason).not.toContain("$");
  });

  it("ignores tools that do not leave the machine", () => {
    const context = testContext({ tools: [alphaVantage, generalTool("memory_update", "write-local")] });
    const event: BeforeToolEvent = {
      stage: "before_tool",
      toolName: "memory_update",
      toolCallId: "call_2",
      args: { text: "$TSLY ETF distribution" },
      tool: generalTool("memory_update", "write-local"),
    };

    expect(p1TrustedSourcesFirst(event, context)).toBeUndefined();
  });

  it("resolves the company from its filer name, so a tried connection lifts the block", () => {
    const ledger = testLedger();
    ledger.add({ kind: "E", summary: "EDGAR filings", entity: { ticker: "NVDA", name: "NVIDIA CORP" } });
    const earnings = dataTool("alphavantage__EARNINGS", {
      id: "alphavantage",
      name: "Alpha Vantage",
      tier: 2,
      coverage: ["earnings"],
    });
    const context = testContext({ ledger, tools: [earnings, search] });
    context.state.connectionsTried.set("NVDA", new Set(["alphavantage"]));
    const query = "Nvidia shares Wednesday close earnings results stock reaction";

    expect(p1TrustedSourcesFirst(searchFor(query), context)).toBeUndefined();
  });

  it("still blocks when that connection was only tried for another company", () => {
    const ledger = testLedger();
    ledger.add({ kind: "E", summary: "EDGAR filings", entity: { ticker: "NVDA", name: "NVIDIA CORP" } });
    const earnings = dataTool("alphavantage__EARNINGS", {
      id: "alphavantage",
      name: "Alpha Vantage",
      tier: 2,
      coverage: ["earnings"],
    });
    const context = testContext({ ledger, tools: [earnings, search] });
    context.state.connectionsTried.set("AMD", new Set(["alphavantage"]));

    expect(p1TrustedSourcesFirst(searchFor("Nvidia earnings results"), context)?.kind).toBe("block");
  });

  it("lifts a query that names no company once the connection was tried for one", () => {
    const news = dataTool("alphavantage__NEWS_SENTIMENT", {
      id: "alphavantage",
      name: "Alpha Vantage",
      tier: 2,
      coverage: ["news", "macro"],
    });
    const context = testContext({ tools: [news, search] });
    context.state.connectionsTried.set("NVDA", new Set(["alphavantage"]));
    const query = "stock market Wednesday close Nasdaq tech stocks Treasury yields";

    expect(p1TrustedSourcesFirst(searchFor(query), context)).toBeUndefined();
  });

  it("still blocks a company-less query while the connection is untouched", () => {
    const news = dataTool("alphavantage__NEWS_SENTIMENT", {
      id: "alphavantage",
      name: "Alpha Vantage",
      tier: 2,
      coverage: ["news", "macro"],
    });
    const context = testContext({ tools: [news, search] });
    const query = "stock market Wednesday close Nasdaq tech stocks Treasury yields";

    expect(p1TrustedSourcesFirst(searchFor(query), context)?.kind).toBe("block");
  });

  it("prefers the lowest tier when two connections cover the domain", () => {
    const vendorFilings = dataTool("vendor_filings", {
      id: "vendor",
      name: "Vendor",
      tier: 2,
      coverage: ["filings"],
    });
    const context = testContext({ tools: [vendorFilings, edgar, search] });
    const verdict = p1TrustedSourcesFirst(searchFor("$NVDA 10-K risk factors"), context);

    expect(verdict?.reason).toContain("edgar_filings");
  });
});
