import { describe, expect, it } from "vitest";
import { evidenceTable } from "./evidence-table";
import { fixtureLedger } from "./ledger.fixture";
import { validateReportSpec } from "./validate";
import { renderReport } from "./render";

describe("tables from stored evidence", () => {
  it("keeps exact periods and per-metric units, and leaves missing observations empty", () => {
    const ledger = fixtureLedger();
    expect(evidenceTable({ type: "evidence_table", source: "E1", metrics: ["revenue", "dilutedEps"] }, ledger)).toEqual({
      type: "table", columns: ["Period", "Revenue", "Diluted Eps"], rows: [
        ["FY26 Q2", { value: 4318000000, unit: "USD", src: "E1", metric: "revenue", period: "FY26 Q2" },
          { value: 1.79, unit: "USD/share", src: "E1", metric: "dilutedEps", period: "FY26 Q2" }],
        ["FY25 Q2", { value: 3883000000, unit: "USD", src: "E1", metric: "revenue", period: "FY25 Q2" }, "not reported"],
      ],
    });
  });

  it("renders a computed series with source citations and splits a long table into slides", () => {
    const ledger = fixtureLedger();
    const source = ledger.add({ kind: "C", summary: "Margins", unit: "%", inputs: ["E1"],
      table: { columns: ["period", "margin"], index: "period", rows: Array.from({ length: 15 }, (_, i) => [String(2000+i), 15+i]) } });
    const checked = validateReportSpec({ title: "Margins", sections: [{ heading: "History", blocks: [{ type: "evidence_table", source: source.id }] }] }, ledger, { defaultFormat: "slides" });
    expect(checked.issues).toEqual([]);
    if (!checked.spec) return;
    const result = renderReport(checked.spec, ledger, "slides");
    expect(result.figures).toContain(source.id);
    expect(result.html).toContain('class="fig">15%');
    expect(result.html).toContain("History (cont.)");
  });

  it("rejects missing metrics, unavailable sources and conflicting observations", () => {
    const ledger = fixtureLedger();
    expect(() => evidenceTable({ type: "evidence_table", source: "E1", metrics: ["invented"] }, ledger)).toThrow("Available:");
    ledger.get("E1")!.lookAhead = true;
    expect(() => evidenceTable({ type: "evidence_table", source: "E1" }, ledger)).toThrow("turn cutoff");
    const source = ledger.add({ kind: "E", summary: "Conflicting", facts: [
      { metric: "revenue", period: "FY24", value: 100, unit: "USD" }, { metric: "revenue", period: "FY24", value: 200, unit: "USD" },
    ] });
    const checked = validateReportSpec({ title: "Facts", sections: [{ heading: "History", blocks: [{ type: "evidence_table", source: source.id }] }] }, ledger, { defaultFormat: "doc" });
    expect(checked.issues[0]).toMatchObject({ kind: "sources", section: "History", message: expect.stringContaining("conflicting values") });
  });
});
