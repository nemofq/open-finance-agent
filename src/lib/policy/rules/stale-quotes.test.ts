import { describe, expect, it } from "vitest";
import type { EvidenceEntry } from "@/lib/evidence/types";
import type { AfterToolEvent } from "../events";
import { dataTool, testContext, testLedger } from "../testing";
import { p4StaleQuote } from "./stale-quotes";

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

function result(entry: EvidenceEntry, tool = quote, isError = false): AfterToolEvent {
  return {
    stage: "after_tool",
    toolName: tool.name,
    toolCallId: "call_1",
    args: { symbol: "NVDA" },
    tool,
    entry,
    isError,
    text: "NVDA 178.20",
    details: undefined,
  };
}

function entryAsOf(asOf: string | undefined): EvidenceEntry {
  return testLedger().add({ kind: "E", summary: "quote", asOf });
}

describe("P4 stale quote", () => {
  it("annotates a quote older than the last completed session", () => {
    const verdict = p4StaleQuote(result(entryAsOf("2026-09-08")), testContext());

    expect(verdict?.kind).toBe("annotate");
    expect(verdict?.text).toBe("Note: quote is as of 2026-09-08, older than the last completed session 2026-09-10.");
  });

  it("leaves a quote from the last completed session alone", () => {
    expect(p4StaleQuote(result(entryAsOf("2026-09-10")), testContext())).toBeUndefined();
  });

  it("leaves a source that does not cover prices alone", () => {
    expect(p4StaleQuote(result(entryAsOf("2020-01-01"), filings), testContext())).toBeUndefined();
  });

  it("says nothing when the entry has no as-of date", () => {
    expect(p4StaleQuote(result(entryAsOf(undefined)), testContext())).toBeUndefined();
  });

  it("says nothing about an errored result", () => {
    expect(p4StaleQuote(result(entryAsOf("2026-09-08"), quote, true), testContext())).toBeUndefined();
  });
});
