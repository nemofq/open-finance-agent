import { describe, expect, it } from "vitest";
import type { InvestorProfile } from "@/lib/profile/types";
import type { BeforeModelEvent } from "../events";
import { testContext, testLedger } from "../testing";
import { detectInstruments, p12ProfileMismatch } from "./profile-fit";

function profile(overrides: Partial<InvestorProfile> = {}): InvestorProfile {
  return { updatedAt: "2026-09-01T00:00:00.000Z", ...overrides };
}

function request(text: string): BeforeModelEvent {
  return { stage: "before_model", text };
}

describe("P12 profile mismatch", () => {
  it("notes an instrument the profile does not allow", () => {
    const context = testContext({
      profile: profile({ constraints: { allowedInstruments: ["stocks", "etfs"] } }),
    });
    const verdict = p12ProfileMismatch(request("Should I sell covered calls on my NVDA?"), context);

    expect(verdict?.kind).toBe("annotate");
    expect(verdict?.text).toContain("options");
    expect(verdict?.text).toContain("allowed: stocks, ETFs");
  });

  it("notes an excluded sector", () => {
    const context = testContext({ profile: profile({ constraints: { exclusions: ["tobacco"] } }) });
    const verdict = p12ProfileMismatch(request("How is Altria's tobacco business doing?"), context);

    expect(verdict?.text).toContain("tobacco");
  });

  it("notes an instrument beyond a beginner's experience", () => {
    const context = testContext({ profile: profile({ experience: { level: "beginner" } }) });
    const verdict = p12ProfileMismatch(request("Explain a 3x leveraged ETF"), context);

    expect(verdict?.text).toContain("beginner");
  });

  it("stays quiet when the request fits the profile", () => {
    const context = testContext({
      profile: profile({ constraints: { allowedInstruments: ["stocks", "etfs"] } }),
    });

    expect(p12ProfileMismatch(request("How did NVDA revenue grow last quarter?"), context)).toBeUndefined();
  });

  it("stays quiet without a profile", () => {
    expect(p12ProfileMismatch(request("Should I sell covered calls?"), testContext())).toBeUndefined();
  });

  it("reads only the current request, not what earlier turns fetched", () => {
    const ledger = testLedger();
    ledger.add({ kind: "E", summary: "Alpha Vantage ETF profile, $TSLY covered-call fund" });
    const context = testContext({
      ledger,
      profile: profile({ constraints: { allowedInstruments: ["stocks"] } }),
    });

    expect(p12ProfileMismatch(request("What was Tesla's revenue last quarter?"), context)).toBeUndefined();
    expect(p12ProfileMismatch(request("And should I sell covered calls on it?"), context)?.text).toContain("options");
  });

  it("treats an empty allowed list as no constraint", () => {
    const context = testContext({ profile: profile({ constraints: { allowedInstruments: [] } }) });

    expect(p12ProfileMismatch(request("Should I buy bitcoin or sell covered calls?"), context)).toBeUndefined();
  });

  it("matches an exclusion as a whole word", () => {
    const context = testContext({ profile: profile({ constraints: { exclusions: ["oil", "weapon"] } }) });

    expect(p12ProfileMismatch(request("How healthy is the soil in Iowa for corn?"), context)).toBeUndefined();
    expect(p12ProfileMismatch(request("Which oil majors pay the most?"), context)?.text).toContain('"oil"');
    expect(p12ProfileMismatch(request("Who makes the most weapons?"), context)?.text).toContain('"weapon"');
  });

  // The benchmark's profile-fit task (evals/tasks.ts, retail-12) relies on this note firing.
  it("notes the leveraged ETF in the benchmark's profile-fit task", () => {
    const context = testContext({
      profile: profile({
        experience: { level: "beginner", role: "individual" },
        objectives: { primary: "preservation", horizon: "1_3y" },
        risk: { tolerance: "low", capacityForLoss: "low", liquidityNeeds: "high" },
        constraints: { allowedInstruments: ["stocks", "etfs"] },
        jurisdiction: { country: "US", baseCurrency: "USD" },
        style: { depth: "brief" },
      }),
    });
    const verdict = p12ProfileMismatch(
      request("Most of my savings are sitting in a handful of tech names and a buddy keeps telling me to add one of those leveraged ETFs to catch up. Am I taking way too much risk here?"),
      context,
    );

    expect(verdict?.reason).toBe("The request involves leverage, which the investor profile does not allow.");
    expect(verdict?.text).toContain("allowed: stocks, ETFs");
  });
});

describe("detectInstruments", () => {
  it("reads the instrument classes a request is about", () => {
    expect(detectInstruments("should I sell covered calls")).toContain("options");
    expect(detectInstruments("buying put options on SPY")).toContain("options");
    expect(detectInstruments("a 3x leveraged ETF")).toContain("leverage");
    expect(detectInstruments("should I buy on margin")).toContain("leverage");
    expect(detectInstruments("how much bitcoin does it hold")).toContain("crypto");
    expect(detectInstruments("the 10-year treasury yield")).toContain("bonds");
    expect(detectInstruments("a low-cost index fund")).toContain("funds");
    expect(detectInstruments("should I buy shares of Apple")).toContain("stocks");
  });

  it("does not read an earnings call as an option", () => {
    expect(detectInstruments("what did they say on the earnings call")).not.toContain("options");
  });

  it("does not read company analysis as an instrument the user would hold", () => {
    expect(detectInstruments("what are my options here")).toEqual([]);
    expect(detectInstruments("revenue grew by leaps and bounds")).toEqual([]);
    expect(detectInstruments("its net leverage and operating leverage")).toEqual([]);
    expect(detectInstruments("a highly leveraged balance sheet after the leveraged buyout")).toEqual([]);
    expect(detectInstruments("how much treasury stock did it retire")).not.toContain("bonds");
    expect(detectInstruments("return on equity and shares outstanding")).toEqual([]);
  });

  it("returns nothing for a request about none of them", () => {
    expect(detectInstruments("who is the chief executive")).toEqual([]);
  });
});
