import { describe, expect, it } from "vitest";
import { compareIds, evidenceOf, findReferences, isEvidenceId, mentionedIds, parseId, reportReference } from "./ids";

describe("evidence ids", () => {
  it("accepts only ids the ledger generates", () => {
    expect(["E1", "C12", "A999999", "U3", "R2"].every(isEvidenceId)).toBe(true);
    expect(["E0", "E01", "E1234567", "X1", "e1", "E", "../E1"].some(isEvidenceId)).toBe(false);
    expect(parseId("C12")).toEqual({ kind: "C", index: 12 });
  });

  it("orders by kind, then by counter", () => {
    expect(["R1", "U2", "C10", "E2", "C9", "A1", "E10"].sort(compareIds)).toEqual(["E2", "E10", "C9", "C10", "A1", "U2", "R1"]);
  });

  it("finds every id-shaped word, whatever its digits", () => {
    expect(mentionedIds("Revenue [E7], margin C12; see R3 and E07, not XE1 or 1E7.")).toEqual(["E7", "C12", "R3", "E07"]);
  });

  it("keeps only well-formed entries carried on a result", () => {
    const entry = { id: "E7", kind: "E", summary: "s", fetchedAt: "2026-09-01" };
    expect(evidenceOf({ evidence: [entry, { id: "E8", kind: "C" }, { id: "Q1", kind: "Q" }] })).toEqual([entry]);
    expect(evidenceOf({ evidence: entry })).toEqual([entry]);
    expect(evidenceOf(null)).toEqual([]);
  });
});

describe("report references", () => {
  it("reads back what it writes", () => {
    for (const [id, ...path] of [["C3"], ["C3", "Plan: reserve | then invest"], ["E7", "revenue", "FY26 Q2"]]) {
      const written = reportReference(id, ...path);
      expect(written).toBeDefined();
      expect(findReferences(`Figure ${written}.`)).toEqual([{ raw: written, id, path, index: 7 }]);
    }
  });

  it("never writes a reference to a report, or a path it could not read back", () => {
    expect(reportReference("R1")).toBeUndefined();
    expect(reportReference("E7", "rev:enue", "FY26")).toBeUndefined();
    expect(reportReference("C3", "label {with braces}")).toBeUndefined();
    expect(reportReference("C3", "two\nlines")).toBeUndefined();
    expect(findReferences("{R1} {X1} {revenue}")).toEqual([]);
  });
});
