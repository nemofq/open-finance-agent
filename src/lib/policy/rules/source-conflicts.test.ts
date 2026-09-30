import { describe, expect, it } from "vitest";
import type { EvidenceEntry } from "@/lib/evidence/types";
import type { AfterToolEvent, BeforeStopEvent } from "../events";
import { dataTool, testContext, testLedger } from "../testing";
import type { ConflictNote } from "../types";
import { p5ConflictUnmentioned, p5SourcesDisagree } from "./source-conflicts";

const vendor = dataTool("alphavantage__INCOME_STATEMENT", {
  id: "alphavantage",
  name: "Alpha Vantage",
  tier: 2,
  coverage: ["fundamentals"],
});

function entryWith(conflicts: EvidenceEntry["conflicts"]): EvidenceEntry {
  return testLedger().add({ kind: "E", summary: "income statement, $NVDA", conflicts });
}

function afterTool(entry: EvidenceEntry): AfterToolEvent {
  return {
    stage: "after_tool",
    toolName: vendor.name,
    toolCallId: "call_1",
    args: { symbol: "NVDA" },
    tool: vendor,
    entry,
    isError: false,
    text: "revenue 30,040",
    details: undefined,
  };
}

const conflict: ConflictNote = {
  entry: "E2",
  with: "E1",
  metric: "revenue",
  period: "FY26 Q2",
  value: 30_040,
  otherValue: 29_800,
};

function stop(text: string): BeforeStopEvent {
  return { stage: "before_stop", text, request: "" };
}

describe("P5 sources disagree", () => {
  it("records a disagreement after the tool call", () => {
    const entry = entryWith([
      { with: "E1", metric: "revenue", period: "FY26 Q2", value: 30_040, otherValue: 29_800, agree: false },
    ]);
    const verdict = p5SourcesDisagree(afterTool(entry), testContext());

    expect(verdict?.kind).toBe("annotate");
    expect(verdict?.reason).toContain("disagree on revenue for FY26 Q2");
    // The evidence track already wrote the note; the check only records it.
    expect(verdict?.text).toBeUndefined();
    expect(verdict?.evidence).toEqual([entry.id, "E1"]);
  });

  it("says nothing when the two sources agree", () => {
    const entry = entryWith([
      { with: "E1", metric: "revenue", period: "FY26 Q2", value: 30_040, otherValue: 30_040, agree: true },
    ]);

    expect(p5SourcesDisagree(afterTool(entry), testContext())).toBeUndefined();
  });

  it("flags an answer that never mentions the conflict", () => {
    const context = testContext();
    context.state.conflicts.push(conflict);
    const verdict = p5ConflictUnmentioned(stop("Revenue was 30,040 million in the quarter."), context);

    expect(verdict?.kind).toBe("flag");
    expect(verdict?.evidence).toEqual(["E2", "E1"]);
  });

  it("accepts an answer that names the disagreement", () => {
    const context = testContext();
    context.state.conflicts.push(conflict);

    expect(p5ConflictUnmentioned(stop("The two sources differ on revenue."), context)).toBeUndefined();
  });

  it("accepts an answer that shows both values", () => {
    const context = testContext();
    context.state.conflicts.push(conflict);
    const answer = "Revenue was 30,040 million on one source and 29,800 million on the other.";

    expect(p5ConflictUnmentioned(stop(answer), context)).toBeUndefined();
  });

  it("says nothing when no conflict was seen", () => {
    expect(p5ConflictUnmentioned(stop("Revenue was 30,040 million."), testContext())).toBeUndefined();
  });
});
