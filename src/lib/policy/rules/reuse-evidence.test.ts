import { describe, expect, it } from "vitest";
import type { EvidenceLedger } from "@/lib/evidence/types";
import type { BeforeToolEvent } from "../events";
import { dataTool, generalTool, TEST_NOW, testContext, testLedger } from "../testing";
import { p2DuplicateDataCall } from "./reuse-evidence";

const quote = dataTool("alphavantage__GLOBAL_QUOTE", {
  id: "alphavantage",
  name: "Alpha Vantage",
  tier: 2,
  coverage: ["prices"],
});
const filings = dataTool("edgar_filings", {
  id: "edgar",
  name: "SEC EDGAR",
  tier: 1,
  coverage: ["filings"],
});

function call(tool = quote, args: Record<string, unknown> = { symbol: "NVDA" }): BeforeToolEvent {
  return { stage: "before_tool", toolName: tool.name, toolCallId: "call_1", args, tool };
}

function withQuote(ledger: EvidenceLedger, asOf: string): void {
  ledger.add({
    kind: "E",
    summary: "Alpha Vantage quote, $NVDA",
    tool: "alphavantage__GLOBAL_QUOTE",
    args: { symbol: "NVDA" },
    asOf,
    fetchedAt: new Date(TEST_NOW).toISOString(),
  });
}

describe("P2 duplicate data call", () => {
  it("serves a fresh quote from the ledger instead of fetching again", () => {
    const ledger = testLedger();
    withQuote(ledger, "2026-09-10");
    const verdict = p2DuplicateDataCall(call(), testContext({ ledger }));

    expect(verdict?.kind).toBe("serve");
    expect(verdict?.reason).toBe(
      "Already fetched as E1: Alpha Vantage quote, $NVDA. Use evidence_get E1 for values.",
    );
    expect(verdict?.evidence).toEqual(["E1"]);
  });

  it("allows the call when the quote predates the last completed session", () => {
    const ledger = testLedger();
    withQuote(ledger, "2026-09-08");

    expect(p2DuplicateDataCall(call(), testContext({ ledger }))).toBeUndefined();
  });

  it("allows a call with different arguments", () => {
    const ledger = testLedger();
    withQuote(ledger, "2026-09-10");

    expect(p2DuplicateDataCall(call(quote, { symbol: "AMD" }), testContext({ ledger }))).toBeUndefined();
  });

  it("compares arguments regardless of key order", () => {
    const ledger = testLedger();
    ledger.add({
      kind: "E",
      summary: "EDGAR filings, $NVDA",
      tool: "edgar_filings",
      args: { forms: ["10-K"], ticker: "NVDA" },
      fetchedAt: new Date(TEST_NOW).toISOString(),
    });
    const event = call(filings, { ticker: "NVDA", forms: ["10-K"] });

    expect(p2DuplicateDataCall(event, testContext({ ledger }))?.kind).toBe("serve");
  });

  it("treats a non-price entry fetched on another day as stale", () => {
    const ledger = testLedger();
    ledger.add({
      kind: "E",
      summary: "EDGAR filings, $NVDA",
      tool: "edgar_filings",
      args: { ticker: "NVDA" },
      fetchedAt: "2026-09-09T15:00:00.000Z",
    });

    expect(p2DuplicateDataCall(call(filings, { ticker: "NVDA" }), testContext({ ledger }))).toBeUndefined();
  });

  it("ignores tools that are not data connections", () => {
    const ledger = testLedger();
    withQuote(ledger, "2026-09-10");
    const search = generalTool("web_search");
    const event: BeforeToolEvent = {
      stage: "before_tool",
      toolName: "web_search",
      toolCallId: "call_2",
      args: { symbol: "NVDA" },
      tool: search,
    };

    expect(p2DuplicateDataCall(event, testContext({ ledger }))).toBeUndefined();
  });
});
