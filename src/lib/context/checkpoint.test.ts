import { describe, expect, it } from "vitest";
import { checkpointPrompt, validateCheckpoint } from "./checkpoint";
import { entry } from "./testing";
import { ledgerWith } from "@/lib/evidence/testing";

const ledger = () =>
  ledgerWith([
    entry("E7", {
      summary: "EDGAR income statement, quarterly, $NVDA",
      facts: [{ metric: "revenue", period: "FY26 Q2", value: 30_040_000_000, unit: "USD" }],
    }),
    entry("C3", { summary: "P/E on trailing earnings", value: 28.4, unit: "ratio" }),
  ]);

describe("validateCheckpoint", () => {
  it("keeps a figure whose id sits next to it and holds it", () => {
    const summary = "- Revenue was $30,040M [E7] in FY26 Q2.\n- P/E is 28.4 [C3].";
    expect(validateCheckpoint(summary, ledger())).toEqual({ summary, stripped: [] });
  });

  it("strips a figure no entry holds", () => {
    const result = validateCheckpoint("- Gross margin was 74.9% [E7].", ledger());
    expect(result.stripped).toEqual(["74.9%"]);
    expect(result.summary).toBe("- Gross margin was [figure removed: unsourced] [E7].");
  });

  it("strips a figure the ledger holds but the summary does not attribute", () => {
    const result = validateCheckpoint("- P/E is 28.4, which looks rich.", ledger());
    expect(result.stripped).toEqual(["28.4"]);
    expect(result.summary).toContain("[figure removed: unsourced]");
  });

  it("strips a figure whose nearby id belongs to another value", () => {
    const result = validateCheckpoint("- P/E is 28.4 [E7].", ledger());
    expect(result.stripped).toEqual(["28.4"]);
  });

  it("leaves years, fiscal labels and tickers alone", () => {
    const summary = "- $NVDA FY26 Q2 closed in 2026, the second quarter of fiscal 2026.";
    expect(validateCheckpoint(summary, ledger())).toEqual({ summary, stripped: [] });
  });

  it("leaves citations, form names and item references alone", () => {
    // These are exempt in the evidence track's extractor; the test fails loudly if that regresses.
    const summary = "- Revenue was $30,040M [E7] per the 10-Q, Item 2.02 and Exhibit 99.1; P/E 28.4 [C3].";
    expect(validateCheckpoint(summary, ledger())).toEqual({ summary, stripped: [] });
  });

  it("strips every unsourced figure without disturbing the sourced ones", () => {
    const result = validateCheckpoint("Revenue $30,040M [E7], margin 74.9%, P/E 28.4 [C3].", ledger());
    expect(result.stripped).toEqual(["74.9%"]);
    expect(result.summary).toBe("Revenue $30,040M [E7], margin [figure removed: unsourced], P/E 28.4 [C3].");
  });
});

describe("checkpointPrompt", () => {
  const prompt = () =>
    checkpointPrompt({
      transcript: "[User]: how did $NVDA do?",
      evidenceIndex: "[E7 · SEC EDGAR · tier 1] income statement",
      focus: "the margin story",
      date: "2026-09-13",
      previous: "older checkpoint",
      unsourced: ["74.9%"],
    });

  it("tells the model to summarize rather than answer, with an id on every figure", () => {
    const { system } = prompt();
    expect(system).toContain("Do not continue the conversation");
    expect(system).toContain("must be followed by the evidence id");
    expect(system).toContain("Never round, convert,");
  });

  it("asks for every checkpoint section", () => {
    const { user } = prompt();
    for (const section of [
      "### Scope",
      "### Facts",
      "### Assumptions and calculations",
      "### Source status",
      "### User instructions",
      "### Conclusions",
      "### In progress",
    ]) {
      expect(user).toContain(section);
    }
  });

  it("carries the date, the focus, the previous checkpoint and what to fix", () => {
    const { user } = prompt();
    expect(user).toContain("Today's date: 2026-09-13");
    expect(user).toContain("focus on: the margin story");
    expect(user).toContain("older checkpoint");
    expect(user).toContain("74.9%");
    expect(user).toContain("[E7 · SEC EDGAR · tier 1] income statement");
    expect(user).toContain("[User]: how did $NVDA do?");
  });
});
