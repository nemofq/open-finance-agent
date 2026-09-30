import { describe, expect, it } from "vitest";
import { formatProfileForPrompt } from "./prompt";
import type { InvestorProfile } from "./types";

const base: InvestorProfile = { updatedAt: "2026-09-13T10:00:00.000Z" };

describe("formatProfileForPrompt", () => {
  it("returns nothing for a profile with no fields set", () => {
    expect(formatProfileForPrompt(base)).toBe("");
  });

  it("writes a compact block of at most 12 lines", () => {
    const block = formatProfileForPrompt({
      ...base,
      experience: { level: "intermediate", role: "individual" },
      objectives: { primary: "income", horizon: "3_10y" },
      risk: { tolerance: "moderate", capacityForLoss: "medium", liquidityNeeds: "low" },
      constraints: { allowedInstruments: ["stocks", "etfs", "funds"], exclusions: ["tobacco", "weapons"] },
      jurisdiction: { country: "US", taxResidency: "US", baseCurrency: "USD", accountTypes: ["401k"] },
      style: {
        approach: "dividend",
        preferredMetrics: ["free cash flow", "payout ratio"],
        depth: "standard",
        answerLanguage: "English",
      },
    });

    const lines = block.split("\n");
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(lines[0]).toBe("## Investor profile");
    expect(lines).toContain("- Experience: intermediate individual investor");
    expect(lines).toContain("- Objective: income over 3-10 years");
    expect(lines).toContain("- Risk: moderate tolerance, medium capacity for loss, low liquidity needs");
    expect(lines).toContain("- Allowed instruments: stocks, ETFs, funds");
    expect(lines).toContain("- Avoids: tobacco, weapons");
    expect(lines).toContain("- Base currency: USD; country: US; tax residency: US; accounts: 401k");
    expect(lines).toContain("- Style: dividend approach, prefers free cash flow and payout ratio");
    expect(lines).toContain("- Answers: standard depth, in English");
    expect(lines[lines.length - 1]).toMatch(/never the evidence standard.*not buy or sell advice/);
  });

  it("lists only the fields that are set", () => {
    const block = formatProfileForPrompt({ ...base, risk: { tolerance: "very_high" } });
    expect(block.split("\n")).toEqual([
      "## Investor profile",
      "- Risk: very high tolerance",
      "It changes framing, emphasis and depth, never the evidence standard; answers stay research, not buy or sell advice.",
    ]);
  });

  it("keeps a lone horizon and an empty group readable", () => {
    const block = formatProfileForPrompt({ ...base, objectives: { horizon: "over_10y" }, style: {} });
    expect(block).toContain("- Horizon: 10+ years");
    expect(block).not.toContain("- Answers");
    expect(block).not.toContain("- Style");
  });
});
