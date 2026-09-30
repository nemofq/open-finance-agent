import { describe, expect, it } from "vitest";
import { fixtureLedger } from "./ledger.fixture";
import { findReferences } from "@/lib/evidence/ids";
import { resolveReference, rewriteReferences } from "./references";

const ledger = fixtureLedger();

const resolve = (raw: string) => {
  const [hit] = findReferences(raw);
  return resolveReference(hit, ledger);
};

describe("findReferences", () => {
  it("preserves a calculated series label as one exact string, including colons and spaces", () => {
    const label = "Plan: reserve | then invest: +5%";
    expect(findReferences(`{C2:${label}}`)[0].path).toEqual([label]);
    expect(findReferences("{E1: revenue : FY26 Q2 }")[0].path).toEqual(["revenue", "FY26 Q2"]);
  });

  it("reads both forms, in order", () => {
    const hits = findReferences("Revenue {E1:revenue:FY26 Q2} grew {C1} on the year.");
    expect(hits.map((hit) => [hit.id, hit.path])).toEqual([
      ["E1", ["revenue", "FY26 Q2"]],
      ["C1", []],
    ]);
    expect(hits[0].index).toBe(8);
  });

  it("ignores braces that are not references", () => {
    expect(findReferences("{revenue} and {X1}")).toEqual([]);
  });
});

describe("resolveReference", () => {
  it("selects an exact calculated series label, retaining its unit and cutoff", () => {
    const seriesLedger = fixtureLedger();
    const entry = seriesLedger.add({ kind: "C", summary: "Scenario income", unit: "USD", table: {
      columns: ["label", "value"], index: "label", rows: [["3.5% yield", 7000], ["3.0% yield", 6000]],
    } });
    const hit = findReferences(`{${entry.id}:3.5% yield}`)[0];
    expect(resolveReference(hit, seriesLedger)).toMatchObject({ ok: true, reference: { value: 7000, unit: "USD", period: "3.5% yield", text: "USD 7,000" } });
    expect(resolveReference({ ...hit, path: ["4.0% yield"] }, seriesLedger).ok).toBe(false);
    for (const path of [[], ["Scenario income", "3.5% yield"]]) {
      const invalid = resolveReference({ ...hit, path }, seriesLedger);
      expect(invalid).toMatchObject({ ok: false, message: expect.stringContaining(`{${entry.id}:label}`) });
      expect(!invalid.ok && invalid.message).not.toContain("calculator");
    }
    entry.lookAhead = true;
    expect(resolveReference(hit, seriesLedger).ok).toBe(false);
  });

  it("resolves a single-value entry to its formatted value", () => {
    const result = resolve("{C1}");
    expect(result.ok && result.reference.text).toBe("11.2%");
    expect(resolve("{A1}").ok && resolve("{A1}")).toMatchObject({ reference: { text: "8.5%" } });
  });

  it("resolves a fact by metric and period, whatever the spelling", () => {
    expect(resolve("{E1:revenue:FY26 Q2}").ok && resolve("{E1:revenue:FY26 Q2}")).toMatchObject({
      reference: { text: "USD 4.32B", period: "FY26 Q2" },
    });
    expect(resolve("{E1:Diluted EPS:fy26q2}").ok && resolve("{E1:Diluted EPS:fy26q2}")).toMatchObject({
      reference: { text: "USD 1.79 per share" },
    });
  });

  it("matches a metric name whatever its case and separators, and nothing looser", () => {
    const source = fixtureLedger();
    const entry = source.add({ kind: "E", summary: "Margins", facts: [
      { metric: "grossMargin", period: "FY26 Q2", value: 61.5, unit: "%" },
      { metric: "revenueGrowthYoY", period: "FY26 Q2", value: 11.2, unit: "%" },
    ] });
    for (const metric of ["Gross Margin", "gross_margin", "GROSS-MARGIN", "grossmargin"]) {
      expect(resolveReference(findReferences(`{${entry.id}:${metric}:FY26 Q2}`)[0], source)).toMatchObject({ ok: true, reference: { value: 61.5 } });
    }
    expect(resolveReference(findReferences(`{${entry.id}:Revenue YoY:FY26 Q2}`)[0], source).ok).toBe(false);
  });

  it("resolves a fact by its period end date", () => {
    expect(resolve("{E1:revenue:2026-06-30}").ok).toBe(true);
  });

  it("names the entry when it is not in the ledger", () => {
    const result = resolve("{C9}");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("C9 is not in the evidence ledger");
  });

  it("tells the model the fact syntax when a source is referenced bare", () => {
    const result = resolve("{E1}");
    expect(!result.ok && result.message).toContain("{E1:metric:period}");
  });

  it("lists what the entry does hold when the metric is wrong", () => {
    const result = resolve("{E1:ebitda:FY26 Q2}");
    expect(!result.ok && result.message).toContain("revenue:FY26 Q2");
  });

  it("rejects a reference with the wrong number of parts", () => {
    expect(resolve("{E1:revenue}").ok).toBe(false);
  });
});

describe("rewriteReferences", () => {
  it("replaces each reference and records the entries used", () => {
    const result = rewriteReferences("Revenue {E1:revenue:FY26 Q2}, up {C1}.", ledger, {
      reference: (reference) => reference.text,
    });
    expect(result.text).toBe("Revenue USD 4.32B, up 11.2%.");
    expect(result.used).toEqual(["E1", "C1"]);
    expect(result.problems).toEqual([]);
  });

  it("leaves an unresolved reference as written and reports it", () => {
    const result = rewriteReferences("Margin {C9}.", ledger, { reference: (r) => r.text });
    expect(result.text).toBe("Margin {C9}.");
    expect(result.problems).toHaveLength(1);
  });

  it("applies the literal hook to the text between references", () => {
    const result = rewriteReferences("a & b {C1}", ledger, {
      reference: (reference) => reference.text,
      literal: (chunk) => chunk.replace(/&/g, "&amp;"),
    });
    expect(result.text).toBe("a &amp; b 11.2%");
  });
});
