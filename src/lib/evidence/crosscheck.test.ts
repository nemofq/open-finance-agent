import { describe, expect, it } from "vitest";
import { crossCheck } from "./crosscheck";
import type { EvidenceEntry, EvidenceFact } from "./types";

const end = "2023-05-31";
const entry = (id: string, facts: EvidenceFact[]): EvidenceEntry => ({ id, kind: "E", summary: id, fetchedAt: "2024-01-01T00:00:00Z", entity: { ticker: "TEST" }, facts });
/** A statement fact the way EDGAR states it: a flow on its period basis, a balance at an instant. */
const edgar = (id: string, period: "annual" | "quarterly", value: number, balance = false): EvidenceEntry =>
  entry(id, [{ metric: balance ? "assets" : "revenue", period: end, periodType: balance ? "instant" : period, value, unit: "USD" }]);
/** A vendor result carrying both the quarterly and the annual report for the same end date. */
const av = (id: string, quarterly: number, annual: number, balance = false): EvidenceEntry =>
  entry(id, [
    { metric: balance ? "assets" : "revenue", period: end, periodType: balance ? "instant" : "quarterly", value: quarterly, unit: "USD" },
    { metric: balance ? "assets" : "revenue", period: end, periodType: balance ? "instant" : "annual", value: annual, unit: "USD" },
  ]);

describe("fact period identity", () => {
  it("does not call annual and quarterly revenue on the same end date conflicting sources", () => {
    const annual = edgar("E2", "annual", 51_217e6);
    const quarterly = edgar("E1", "quarterly", 12_825e6);
    expect(crossCheck(annual, [quarterly])).toEqual({ conflicts: [], lines: [] });
    expect(crossCheck(quarterly, [annual])).toEqual({ conflicts: [], lines: [] });
  });

  it("still flags actual disagreement between quarterly sources", () => {
    const result = crossCheck(av("E2", 13_000e6, 51_217e6), [edgar("E1", "quarterly", 12_825e6)]);
    expect(result.conflicts).toEqual([{ with: "E1", metric: "revenue", period: end, value: 13_000e6, otherValue: 12_825e6, agree: false }]);
  });

  it("finds the comparable annual fact after a quarterly fact in a mixed vendor result", () => {
    const result = crossCheck(edgar("E2", "annual", 51_217e6), [av("E1", 12_825e6, 51_217e6)]);
    expect(result.conflicts).toEqual([{ with: "E1", metric: "revenue", period: end, value: 51_217e6, otherValue: 51_217e6, agree: true }]);
  });

  it("compares balance-sheet instants across annual and quarterly statements", () => {
    expect(crossCheck(edgar("E2", "annual", 40e9, true), [edgar("E1", "quarterly", 42e9, true)]).conflicts)
      .toEqual([{ with: "E1", metric: "assets", period: end, value: 40e9, otherValue: 42e9, agree: false }]);
    expect(crossCheck(edgar("E2", "annual", 40e9, true), [av("E1", 40e9, 40e9, true)]).conflicts[0]?.agree).toBe(true);
  });

  it("does not guess the basis of an unqualified fact", () => {
    const known = edgar("E1", "quarterly", 12_825e6);
    const unknown = { ...known, id: "E2", facts: [{ metric: "revenue", period: end, value: 51_217e6, unit: "USD" }] };
    expect(crossCheck(known, [unknown]).conflicts).toEqual([]);
  });
});
