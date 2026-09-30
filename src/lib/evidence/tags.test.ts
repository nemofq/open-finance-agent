import { describe, expect, it } from "vitest";
import { evidenceTag } from "./tags";
import type { EvidenceEntry } from "./types";

const base: EvidenceEntry = {
  id: "E7",
  kind: "E",
  summary: "EDGAR income statement",
  fetchedAt: "2026-08-02T10:00:00.000Z",
  source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
  asOf: "2026-08-01",
};

describe("evidenceTag", () => {
  it("opens a result with id, source, tier and as-of date", () => {
    expect(evidenceTag(base)).toBe("[E7 · SEC EDGAR · tier 1 · as of 2026-08-01]");
  });

  it("says what the entry holds and flags look-ahead", () => {
    expect(evidenceTag({ ...base, facts: [{ metric: "revenue", period: "FY25 Q2", value: 1, unit: "USD" }] })).toContain(
      "1 fact",
    );
    expect(
      evidenceTag({ ...base, table: { columns: ["Line", "a", "b", "c"], rows: [[1], [2], [3], [4], [5], [6], [7], [8]] } }),
    ).toContain("table 8×4");
    expect(evidenceTag({ ...base, lookAhead: true })).toContain("LOOK-AHEAD");
  });

  it("falls back to the kind for an entry with no source", () => {
    expect(evidenceTag({ id: "C3", kind: "C", summary: "CAGR", fetchedAt: base.fetchedAt })).toBe("[C3 · computed]");
  });
});
