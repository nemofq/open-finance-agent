import { describe, expect, it } from "vitest";
import type { EvidenceLedger } from "@/lib/evidence/types";
import type { BeforeStopEvent } from "../events";
import { testContext, testLedger } from "../testing";
import type { CheckRecord } from "../types";
import { p8UnsourcedFigures } from "./answer-grounding";

function stop(text: string): BeforeStopEvent {
  return { stage: "before_stop", text, request: "" };
}

function withRevenue(ledger: EvidenceLedger): void {
  ledger.add({
    kind: "E",
    summary: "EDGAR income statement, $NVDA",
    source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
    facts: [{ metric: "revenue", period: "FY26 Q2", value: 30_040_000_000, unit: "USD" }],
  });
}

describe("P8 unsourced figures", () => {
  it("keeps a wrong citation rejected while pointing to matching source values", () => {
    const ledger = testLedger();
    withRevenue(ledger);
    const wrong = ledger.add({ kind: "C", summary: "Other amount", value: 42, unit: "USD" });
    const verdict = p8UnsourcedFigures(stop(`Revenue was $30.04B [${wrong.id}].`), testContext({ ledger }));
    expect(verdict?.kind).toBe("follow_up");
    expect(verdict?.text).toContain("does not match its cited evidence");
    expect(verdict?.text).toContain("Equal values appear in E1");
    expect(verdict?.text).toContain("verify the subject, metric and period");
  });

  it("asks the model to source a figure the ledger does not hold", () => {
    const ledger = testLedger();
    withRevenue(ledger);
    const verdict = p8UnsourcedFigures(stop("Revenue was $30.04B and the margin was 74.6%."), testContext({ ledger }));

    expect(verdict?.kind).toBe("follow_up");
    expect(verdict?.figures).toEqual(["74.6%"]);
    expect(verdict?.text).toContain("financial_calculator");
    expect(verdict?.text).toContain("74.6%");
  });

  it("asks about a figure once per run, then flags it", () => {
    const ledger = testLedger();
    withRevenue(ledger);
    const checks: CheckRecord[] = [];
    const context = testContext({ ledger, checks });
    const first = p8UnsourcedFigures(stop("The margin was 74.6%."), context);
    expect(first?.kind).toBe("follow_up");
    checks.push({
      id: "chk_1",
      rule: "P8",
      kind: "follow_up",
      reason: first!.reason,
      figures: first!.figures,
      stage: "before_stop",
      mode: "enforce",
      enforced: true,
      timestamp: 0,
    });

    const again = p8UnsourcedFigures(stop("The margin was 74.6% again."), context);
    expect(again?.kind).toBe("flag");
    expect(again?.reason).toContain("already asked");

    // A new unsourced figure beside the old one is still worth a follow-up.
    const fresh = p8UnsourcedFigures(stop("The margin was 74.6% and opex was $9.1B."), context);
    expect(fresh?.kind).toBe("follow_up");
    expect(fresh?.figures).toEqual(["74.6%", "$9.1B"]);
  });

  it("says nothing when every figure is backed", () => {
    const ledger = testLedger();
    withRevenue(ledger);

    expect(p8UnsourcedFigures(stop("Revenue was $30.04B."), testContext({ ledger }))).toBeUndefined();
  });

  it("distinguishes a changed sign from a figure already challenged", () => {
    const context = testContext({ checks: [{ id: "chk_1", rule: "P8", kind: "follow_up", reason: "Missing margin",
      figures: ["-15%"], stage: "before_stop", mode: "enforce", enforced: true, timestamp: 0 }] });
    expect(p8UnsourcedFigures(stop("Margin -15%."), context)?.kind).toBe("flag");
    expect(p8UnsourcedFigures(stop("Margin +15%."), context)).toMatchObject({ kind: "follow_up", figures: ["+15%"] });
  });

  it("ignores years, dates and fiscal labels", () => {
    const ledger = testLedger();

    expect(p8UnsourcedFigures(stop("FY26 Q2 ended on 2026-07-27, a year after 2025."), testContext({ ledger }))).toBeUndefined();
  });

  it("flags instead of asking once the follow-up budget is spent", () => {
    const context = testContext({ followUpsLeft: 0 });
    const verdict = p8UnsourcedFigures(stop("The margin was 74.6%."), context);

    expect(verdict?.kind).toBe("flag");
    expect(verdict?.text).toBeUndefined();
  });

  it("asks for citations only when the calculator is unavailable", () => {
    const context = testContext({ calculatorAvailable: false });
    const verdict = p8UnsourcedFigures(stop("The margin was 74.6%."), context);

    expect(verdict?.kind).toBe("follow_up");
    expect(verdict?.text).not.toContain("financial_calculator");
    expect(verdict?.text).toContain("calculator is unavailable");
  });
});
