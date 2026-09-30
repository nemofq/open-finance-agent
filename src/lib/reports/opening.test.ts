import { expect, it } from "vitest";
import { fixtureLedger } from "./ledger.fixture";
import { reportOpening } from "./opening";
import type { ReportSpec } from "./spec";

it("keeps whole opening paragraphs within a bounded excerpt", () => {
  const spec: ReportSpec = { title: "Research", sections: [{ heading: "Conclusion", blocks: [
    { type: "text", text: "Growth was {C1}." },
    { type: "text", text: "Supporting detail. ".repeat(200) + "Revenue was {E1:revenue:FY26 Q2}." },
    { type: "text", text: "This comes after the omitted paragraph." },
  ] }] };
  const opening = reportOpening(spec, fixtureLedger());
  expect(opening).toContain("Growth was 11.2% [C1].");
  expect(opening).not.toContain("Supporting detail");
  expect(opening).not.toContain("This comes after");
  expect(opening.length).toBeLessThan(3_000);
});

it("leaves a report without opening prose as a compact receipt", () => {
  const spec: ReportSpec = { title: "Research", sections: [{ heading: "History", blocks: [
    { type: "evidence_table", source: "E1" },
  ] }] };
  expect(reportOpening(spec, fixtureLedger())).toBe("");
});
