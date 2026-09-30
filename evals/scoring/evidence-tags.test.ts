import { describe, expect, it } from "vitest";
import { EVIDENCE_TAG_LINE } from "./checks";
import { EVIDENCE_TAG } from "./judge";

/**
 * The scorer and the judge read evidence tags with patterns built from the ledger's own kind
 * letters. Scoring must not move when they are, so each is pinned to the literal it replaced.
 */
describe("evidence tag patterns", () => {
  it("are exactly the patterns the scorer and the judge were calibrated with", () => {
    expect(EVIDENCE_TAG_LINE.source).toBe(String.raw`^\[[ECAUR]\d+\b`);
    expect(EVIDENCE_TAG_LINE.flags).toBe("");
    expect(EVIDENCE_TAG.source).toBe(String.raw`\[[ECAUR]\d+(?:\s*,\s*[ECAUR]\d+)*\]`);
    expect(EVIDENCE_TAG.flags).toBe("");
  });

  it("take every kind of entry and nothing else", () => {
    for (const kind of ["E", "C", "A", "U", "R"]) {
      expect(EVIDENCE_TAG_LINE.test(`[${kind}7] SEC EDGAR`)).toBe(true);
      expect(EVIDENCE_TAG.test(`see [${kind}7]`)).toBe(true);
    }
    for (const line of ["[X7] other", "[e7] lower case", "[E] no counter", "text [E7] later"]) {
      expect(EVIDENCE_TAG_LINE.test(line)).toBe(false);
    }
    expect(EVIDENCE_TAG.test("[C3, E1]")).toBe(true);
    expect(EVIDENCE_TAG.test("[C3, X1]")).toBe(false);
  });
});
