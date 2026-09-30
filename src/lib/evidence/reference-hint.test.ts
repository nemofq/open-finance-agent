import { expect, it } from "vitest";
import { recordResults } from "@/lib/calculator/evidence";
import { formatResult } from "@/lib/calculator/format";
import { resolveReference } from "@/lib/reports/references";
import { renderReport } from "@/lib/reports/render";
import { validateReportSpec } from "@/lib/reports/validate";
import type { SandboxResult } from "@/lib/sandbox/protocol";
import { createLedger } from "./ledger";
import { findReferences, reportReference } from "./ids";
import { referenceHint } from "./reference-hint";

it("supplies exact source references with subject, metric and period", () => {
  const ledger = createLedger({ sessionId: "refs" });
  const source = ledger.add({ kind: "E", summary: "AMD revenue", entity: { ticker: "AMD" }, facts: [
    { metric: "revenue", period: "2024-09-28", value: 6819, unit: "USD" },
  ] });
  const hint = referenceHint(source)!;
  expect(hint).toContain("for AMD");
  expect(hint).toContain("{E1:revenue:2024-09-28}");
  expect(resolveReference(findReferences(hint)[0], ledger)).toMatchObject({ ok: true, reference: { value: 6819, entry: { id: source.id } } });
  source.facts!.push({ ...source.facts![0], value: 9000 });
  expect(referenceHint(source)).toBeUndefined(); // ambiguous facts are not advertised
  expect(reportReference("C1", "label {with braces}")).toBeUndefined();
});

it("copies scalar and series references into a report with declared hypothetical assumptions", () => {
  const ledger = createLedger({ sessionId: "scenario" });
  const result: SandboxResult = { type: "result", id: "scenario", ok: true, durationMs: 1, finVersion: "test",
    emitted: [{ name: "Illustrative yield", value: 0.08, unit: "%" },
      { name: "Illustrative distribution", value: { "Base: illustrative": 80, "Stress: illustrative": 60 }, unit: "USD" }],
    assumptions: [{ name: "Illustrative principal", value: 1000, why: "Hypothetical example, not company financials" }],
    undeclaredConstants: [], usedEvidence: [], stdout: "" };
  const recorded = recordResults(ledger, result);
  const text = formatResult(result, recorded, ledger);
  const references = findReferences(text);
  expect(references.map((r) => r.raw)).toEqual(["{C1}", "{C2:Base: illustrative}", "{C2:Stress: illustrative}"]);
  expect(references.map((r) => resolveReference(r, ledger))).toEqual(expect.arrayContaining([
    expect.objectContaining({ ok: true, reference: expect.objectContaining({ value: 8, unit: "%" }) }),
    expect.objectContaining({ ok: true, reference: expect.objectContaining({ value: 80, unit: "USD" }) }),
  ]));
  expect(text).toContain("conditional on those inputs");
  const checked = validateReportSpec({ title: "Illustrative mechanics", sections: [{ heading: "Hypothetical example", blocks: [
    { type: "text", text: "This hypothetical yield is {C1}; base distribution is {C2:Base: illustrative}. Line 1 + line 3 + line 4 are row references." },
    { type: "evidence_table", source: "C2" },
  ] }] }, ledger, { defaultFormat: "doc" });
  expect(checked.issues).toEqual([]);
  if (!checked.spec) throw new Error(JSON.stringify(checked.issues));
  const rendered = renderReport(checked.spec, ledger, "doc").html;
  expect(rendered).toContain("Hypothetical example, not company financials");
  expect(rendered).toContain("8%");
});
