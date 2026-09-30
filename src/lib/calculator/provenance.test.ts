import { describe, expect, it } from "vitest";
import { evidenceLineage } from "@/lib/evidence/lineage";
import { createLedger } from "@/lib/evidence/ledger";
import { renderReport } from "@/lib/reports/render";
import type { SandboxResult } from "@/lib/sandbox/protocol";
import { recordResults } from "./evidence";
import { formatResult } from "./format";

function result(over: Partial<SandboxResult>): SandboxResult {
  return { type: "result", id: "1", ok: true, emitted: [], assumptions: [], undeclaredConstants: [],
    usedEvidence: [], stdout: "", durationMs: 1, finVersion: "1.0.0", ...over };
}

describe("calculation provenance", () => {
  it("carries declared and undeclared inputs through later calculations into both report formats", () => {
    const ledger = createLedger({ sessionId: "memory" });
    ledger.add({ kind: "E", summary: "Reported revenue", value: 100, unit: "USD",
      source: { id: "filing", name: "Issuer filing", tier: 1 } });
    ledger.add({ kind: "A", summary: "Unrelated earlier assumption", value: 500 });
    const first = result({ usedEvidence: ["E1", "E1"],
      assumptions: [{ name: "scenario_cost", value: 20, why: "Hypothetical operating cost" }],
      undeclaredConstants: [{ value: 7, line: 3, snippet: "fee = 7" }],
      emitted: [{ name: "Scenario profit", value: 73, unit: "USD", formula: "revenue - cost - fee" }] });
    const recorded = recordResults(ledger, first);
    expect(recorded.computed[0]).toMatchObject({ id: "C1", inputs: ["E1", "A2", "A3"],
      value: 73, unit: "USD", formula: "revenue - cost - fee" });
    expect(recorded.assumed[0]).toMatchObject({ id: "A2", declared: true });
    expect(recorded.undeclared[0]).toMatchObject({ id: "A3", declared: false });

    const later = result({ usedEvidence: ["C1"], emitted: [{ name: "Scenario profit per unit", value: 36.5, unit: "USD" }] });
    const reused = recordResults(ledger, later);
    const text = formatResult(later, reused, ledger);
    expect(text).toContain("assumptions [A2], [A3]");
    expect(text).toContain("conditional on those inputs, not verification");
    expect(text).toContain("[C2] Scenario profit per unit = 36.5 USD");
    expect(text).not.toContain("[A1]");

    for (const format of ["doc", "slides"] as const) {
      const report = renderReport({ title: "Scenario", sections: [{ heading: "Result",
        blocks: [{ type: "text", text: "Under these assumptions, profit per unit is {C2}." }] }] }, ledger, format);
      expect(report.figures).toEqual(["C2"]);
      expect(report.html).toContain("USD 36.50");
      expect(report.html).toContain("Issuer filing");
      expect(report.html).toContain("Hypothetical operating cost");
      expect(report.html).toContain("undeclared constant in calculator code");
      expect(report.html).not.toContain("Unrelated earlier assumption");
    }
  });

  it("keeps a source-only result free of assumption warnings", () => {
    const ledger = createLedger({ sessionId: "memory" });
    ledger.add({ kind: "E", summary: "Revenue", value: 100 });
    const calculation = result({ usedEvidence: ["E1"], emitted: [{ name: "Revenue per unit", value: 50 }] });
    const recorded = recordResults(ledger, calculation);
    expect(recorded.computed[0].inputs).toEqual(["E1"]);
    expect(formatResult(calculation, recorded, ledger)).toBe("[C1] Revenue per unit = 50 (report {C1})");
  });

  it("retains assumption provenance when a calculation fails after emitting a result", () => {
    const ledger = createLedger({ sessionId: "memory" });
    const calculation = result({ ok: false, error: "ZeroDivisionError: division by zero",
      assumptions: [{ name: "scenario_sales", value: 40, why: "Illustrative sales" }],
      emitted: [{ name: "Scenario result", value: 20 }] });
    const recorded = recordResults(ledger, calculation);
    expect(recorded.computed[0].inputs).toEqual(["A1"]);
    const text = formatResult(calculation, recorded, ledger);
    expect(text).toContain("assumptions [A1]");
    expect(text).toContain("The calculation then failed:");
  });

  it("visits shared and cyclic inputs once and tolerates missing old entries", () => {
    const ledger = createLedger({ sessionId: "memory" });
    ledger.add({ kind: "C", summary: "First", inputs: ["C2", "A1", "E99"] });
    ledger.add({ kind: "C", summary: "Second", inputs: ["C1", "A1"] });
    ledger.add({ kind: "A", summary: "Shared assumption", value: 1 });
    expect(evidenceLineage(ledger, ["C1", "C1"]).map((entry) => entry.id)).toEqual(["C1", "C2", "A1"]);
  });
});
