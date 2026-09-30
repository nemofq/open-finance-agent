import { describe, expect, it } from "vitest";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { argsText, companyKey, isExternalGeneralTool, mapArgumentSynonyms, NO_COMPANY, tickerFromArgs, withArgumentSynonyms } from "./args";
import { dataTool, generalTool } from "./testing";

describe("argsText", () => {
  it("collects every string, however deep", () => {
    expect(argsText({ query: "gross margin", urls: ["https://sec.gov"], depth: 2 })).toBe(
      "gross margin https://sec.gov",
    );
  });
});

describe("tickerFromArgs", () => {
  it("reads a symbol argument", () => {
    expect(tickerFromArgs({ symbol: "nvda" })).toBe("NVDA");
  });

  it("reads the first of a list", () => {
    expect(tickerFromArgs({ tickers: ["AMD", "NVDA"] })).toBe("AMD");
  });

  it("falls back to a cashtag in the text", () => {
    expect(tickerFromArgs({ query: "how is $TSLY doing" })).toBe("TSLY");
  });

  it("files a call about no company under the macro key", () => {
    expect(tickerFromArgs({ query: "federal funds rate" })).toBeUndefined();
    expect(companyKey(undefined)).toBe(NO_COMPANY);
  });
});

describe("isExternalGeneralTool", () => {
  it("is true only for a general tool that leaves the machine", () => {
    expect(isExternalGeneralTool(generalTool("web_search"))).toBe(true);
    expect(isExternalGeneralTool(generalTool("memory_update", "write-local"))).toBe(false);
    expect(isExternalGeneralTool(dataTool("edgar", { id: "edgar", name: "EDGAR", tier: 1, coverage: [] }))).toBe(false);
    expect(isExternalGeneralTool(undefined)).toBe(false);
  });
});

describe("argument synonyms", () => {
  const scalar = { ticker: { type: "string" }, limit: { type: "number" } };
  const list = { symbols: { type: "array" } };

  it("maps a synonym the schema lacks onto the one it declares, coercing scalars and one-item arrays", () => {
    expect(mapArgumentSynonyms({ symbol: "NVDA", limit: 4 }, scalar)).toEqual({ ticker: "NVDA", limit: 4 });
    expect(mapArgumentSynonyms({ symbols: ["NVDA"] }, scalar)).toEqual({ ticker: "NVDA" });
    expect(mapArgumentSynonyms({ ticker: "NVDA" }, list)).toEqual({ symbols: ["NVDA"] });
    expect(mapArgumentSynonyms({ symbol: ["NVDA", "AMD"] }, list)).toEqual({ symbols: ["NVDA", "AMD"] });
  });

  it("leaves arguments with no synonym, or an already declared target, untouched", () => {
    const args = { query: "NVDA", ticker: "NVDA" };
    expect(mapArgumentSynonyms(args, { query: { type: "string" } })).toBe(args);
    const both = { ticker: "NVDA", symbol: "AMD" };
    expect(mapArgumentSynonyms(both, scalar)).toBe(both);
  });

  it("wraps a tool so validation sees the declared name and the tool's own preparation still runs", () => {
    const tool = { ...dataTool("edgar_filings", { id: "edgar", name: "SEC EDGAR", tier: 1, coverage: ["filings"] }),
      parameters: Type.Object({ ticker: Type.String() }), prepareArguments: (args: unknown) => ({ ...(args as object), prepared: true }) };
    const wrapped = withArgumentSynonyms(tool);
    expect(wrapped.meta).toBe(tool.meta);
    const prepared = wrapped.prepareArguments!({ symbol: "NVDA" });
    expect(prepared).toEqual({ ticker: "NVDA", prepared: true });
    expect(() => validateToolArguments(wrapped, { type: "toolCall", id: "1", name: wrapped.name, arguments: { company: "NVDA" } })).toThrow(/ticker/);
  });
});
