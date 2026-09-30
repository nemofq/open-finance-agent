import { describe, expect, it } from "vitest";
import type { EvidenceEntry } from "@/lib/evidence/types";
import type { AfterToolEvent } from "../events";
import { dataTool, testContext, testLedger, testTime } from "../testing";
import { p13LookAhead } from "./look-ahead";

const news = dataTool("alphavantage__NEWS_SENTIMENT", {
  id: "alphavantage",
  name: "Alpha Vantage",
  tier: 2,
  coverage: ["news"],
});

function result(entry: EvidenceEntry): AfterToolEvent {
  return {
    stage: "after_tool",
    toolName: news.name,
    toolCallId: "call_1",
    args: { tickers: "NVDA" },
    tool: news,
    entry,
    isError: false,
    text: "headline",
    details: undefined,
  };
}

describe("P13 look-ahead evidence", () => {
  it("records evidence dated after the turn's as-of date", () => {
    const entry = testLedger().add({ kind: "E", summary: "news", asOf: "2026-09-12", lookAhead: true });
    const context = testContext({ time: testTime({ mode: "fixed", asOf: "2026-08-20" }) });
    const verdict = p13LookAhead(result(entry), context);

    expect(verdict?.kind).toBe("annotate");
    expect(verdict?.reason).toContain("2026-09-12");
    expect(verdict?.reason).toContain("2026-08-20");
    expect(verdict?.evidence).toEqual([entry.id]);
  });

  it("says nothing about evidence inside the window", () => {
    const entry = testLedger().add({ kind: "E", summary: "news", asOf: "2026-08-19" });

    expect(p13LookAhead(result(entry), testContext())).toBeUndefined();
  });
});
