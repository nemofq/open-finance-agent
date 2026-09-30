import { describe, expect, it } from "vitest";
import { toolBadges } from "./tool-badges";
import type { MessagePart } from "./transcript";
import { entry } from "./transcript.fixture";

describe("toolBadges", () => {
  const part = (name: string, details: unknown): MessagePart => ({ kind: "tool", id: "t1", name, args: {}, details });

  it("names the source, tier and as-of date of a data result", () => {
    const badges = toolBadges(
      part("edgar_facts", {
        evidence: entry({
          id: "E7",
          kind: "E",
          source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
          asOf: "2026-08-01",
          lookAhead: true,
          conflicts: [{ with: "E1", metric: "revenue", period: "FY25 Q2", value: 1, otherValue: 2, agree: false }],
        }),
      }),
    );
    expect(badges).toEqual({
      label: "SEC EDGAR · tier 1 · as of 2026-08-01",
      ids: ["E7"],
      lookAhead: true,
      conflict: true,
    });
  });

  it("leaves out the as-of date when the entry has none", () => {
    const badges = toolBadges(
      part("av_quote", { evidence: entry({ id: "E1", kind: "E", source: { id: "av", name: "Alpha Vantage", tier: 2 } }) }),
    );
    expect(badges.label).toBe("Alpha Vantage · tier 2");
    expect(badges.conflict).toBe(false);
  });

  it("calls the deterministic tools financial", () => {
    expect(toolBadges(part("create_report", { evidence: entry({ id: "R1", kind: "R" }) }))).toMatchObject({
      label: "Financial tool",
      ids: ["R1"],
    });
    expect(toolBadges(part("financial_calculator", undefined)).label).toBe("Financial tool");
  });

  it("falls back to a general tool with nothing to show", () => {
    expect(toolBadges(part("web_search", undefined))).toEqual({
      label: "General tool",
      ids: [],
      lookAhead: false,
      conflict: false,
    });
    expect(toolBadges({ kind: "text", text: "hi" }).label).toBe("General tool");
  });
});
