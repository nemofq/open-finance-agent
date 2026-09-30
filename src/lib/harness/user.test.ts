import { describe, expect, it } from "vitest";
import type { InvestorProfile } from "@/lib/profile/types";
import { delivery } from "./delivery";
import { testRules, testTurn } from "./testing";
import { user } from "./user";

const beginner: InvestorProfile = { updatedAt: "2026-09-01T00:00:00.000Z", experience: { level: "beginner" } };

/** The per-request note the user and delivery concerns add, after both ran `beforeTurn`. */
function noteFor(request: string, mode: "enforce" | "observe" = "enforce") {
  const turn = testTurn({ mode, request });
  const concern = user(testRules(turn, { profile: beginner }));
  concern.beforeTurn?.(turn, []);
  delivery.beforeTurn?.(turn, []);
  const note = () => [concern.turnNote?.(turn), delivery.turnNote?.(turn)].filter(Boolean).join("\n") || undefined;
  return { concern, note, turn };
}

describe("the user concern", () => {
  it.each(["enforce", "observe"] as const)("computes the P12 note once and records it in %s mode", (mode) => {
    const { concern, turn } = noteFor("Explain a 3x leveraged ETF", mode);
    const note = concern.turnNote?.(turn);
    expect(concern.turnNote?.(turn)).toBe(note);
    expect(note?.includes("beginner") ?? false).toBe(mode === "enforce");
    expect(turn.checks).toHaveLength(1);
    expect(turn.checks[0]).toMatchObject({ rule: "P12", stage: "before_model", enforced: mode === "enforce" });
  });

  it("repeats the context note on every call and records it once", () => {
    const { note, turn } = noteFor("Explain a 3x leveraged ETF");
    const first = note();

    expect(first).toContain("beginner");
    expect(note()).toBe(first);
    expect(turn.checks.filter((check) => check.rule === "P12")).toHaveLength(1);
  });

  it("keeps delivery guidance without a profile warning when the request fits the profile", () => {
    const { note, turn } = noteFor("How did NVDA revenue grow?");

    expect(note()).toContain("Choose before writing");
    expect(turn.checks.filter((check) => check.rule === "P12")).toEqual([]);
  });
});
