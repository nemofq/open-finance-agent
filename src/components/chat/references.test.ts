import { describe, expect, it } from "vitest";
import type { EvidenceEntry } from "@/lib/evidence/types";
import { fillChatReferences } from "./references";

const entry = (fields: Partial<EvidenceEntry> & Pick<EvidenceEntry, "id" | "kind">): EvidenceEntry => ({
  summary: "test entry",
  fetchedAt: "2026-09-01T00:00:00.000Z",
  ...fields,
});

const entries: EvidenceEntry[] = [
  entry({ id: "C17", kind: "C", value: 16.43, unit: "%" }),
  entry({ id: "A2", kind: "A", value: 4.32, unit: "USD B" }),
  entry({ id: "U1", kind: "U", value: 250_000, unit: "USD" }),
  entry({ id: "C9", kind: "C", summary: "no single value" }),
  entry({
    id: "E7",
    kind: "E",
    facts: [
      { metric: "revenue", period: "FY26 Q2", value: 30_040, unit: "USD M", end: "2026-07-28" },
      { metric: "dilutedEps", period: "FY26 Q2", value: 1.87, unit: "USD/share" },
    ],
  }),
];

const fill = (text: string): string => fillChatReferences(text, entries);

describe("fillChatReferences", () => {
  it("resolves a single-value entry with its unit, tagged with the id", () => {
    expect(fill("growth of {C17} this year")).toBe("growth of 16.43% [C17] this year");
    expect(fill("{A2} of cash")).toBe("USD 4.32B [A2] of cash");
    expect(fill("you put in {U1}")).toBe("you put in USD 250,000 [U1]");
  });

  it("resolves several references in one sentence", () => {
    expect(fill("nearly identical ({C17} vs {A2})")).toBe("nearly identical (16.43% [C17] vs USD 4.32B [A2])");
  });

  it("resolves a fact by metric and period, loosely and by canonical name", () => {
    expect(fill("revenue was {E7:revenue:FY26 Q2}")).toBe("revenue was USD 30.04B [E7]");
    expect(fill("{E7:sales:fy26q2}")).toBe("USD 30.04B [E7]");
    expect(fill("{E7:dilutedEps:FY26 Q2}")).toBe("USD 1.87 per share [E7]");
  });

  it("matches a fact by the date its period ended", () => {
    expect(fill("{E7:revenue:2026-07-28}")).toBe("USD 30.04B [E7]");
  });

  it("leaves a reference nothing in the ledger resolves exactly as written", () => {
    expect(fill("margin of {C99}")).toBe("margin of {C99}");
    expect(fill("{E7:revenue:FY25 Q1}")).toBe("{E7:revenue:FY25 Q1}");
    expect(fill("{E7:revenue}")).toBe("{E7:revenue}");
    // A multi-fact entry has no single value, and a single-value one has no facts.
    expect(fill("{E7}")).toBe("{E7}");
    expect(fill("{C9}")).toBe("{C9}");
  });

  it("reads a calculated entry's colon as part of its series label, as reports do", () => {
    const calculated = [entry({ id: "C4", kind: "C", facts: [{ metric: "margin", period: "FY25", value: 12, unit: "%" }] })];
    expect(fillChatReferences("{C4:margin:FY25}", calculated)).toBe("{C4:margin:FY25}");
    expect(fillChatReferences("{E7: revenue : FY26 Q2 }", entries)).toBe("USD 30.04B [E7]");
  });

  it("fills a calculated series item by its label, as reports do", () => {
    const series = [entry({ id: "C5", kind: "C", unit: "USD", table: { columns: ["label", "value"], index: "label", rows: [["3.5% yield", 7000]] } })];
    expect(fillChatReferences("ending at {C5:3.5% yield}", series)).toBe("ending at USD 7,000 [C5]");
  });

  it("leaves a reference to look-ahead evidence as written, withholding its value", () => {
    expect(fillChatReferences("growth of {C17}", [{ ...entries[0], lookAhead: true }])).toBe("growth of {C17}");
  });

  it("leaves malformed braces and ordinary prose alone", () => {
    expect(fill("a {} b {C} c {17} d {c17} e { C17 }")).toBe("a {} b {C} c {17} d {c17} e { C17 }");
    expect(fill("margin held at 16.4%")).toBe("margin held at 16.4%");
  });

  it("does not double-tag a figure the model already wrote with its id", () => {
    expect(fill("16.43% [C17] this year")).toBe("16.43% [C17] this year");
    expect(fill("{C17} [C17] this year")).toBe("16.43% [C17] this year");
  });

  it("leaves references inside code spans and fenced blocks untouched", () => {
    expect(fill("write `{C17}` in the spec")).toBe("write `{C17}` in the spec");
    expect(fill("```\n{C17}\n```\n{C17}")).toBe("```\n{C17}\n```\n16.43% [C17]");
  });

  it("returns the text unchanged when there is nothing to resolve against", () => {
    expect(fillChatReferences("growth of {C17}", [])).toBe("growth of {C17}");
  });
});
