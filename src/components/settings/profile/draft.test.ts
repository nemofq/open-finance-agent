import { describe, expect, it } from "vitest";
import { profilePresets } from "@/lib/profile/presets";
import type { ProfilePreset } from "@/lib/profile/types";
import { cleanDraft, type ProfileDraft, withPreset } from "./draft";

function preset(id: ProfilePreset["id"]): ProfilePreset {
  return profilePresets.find((candidate) => candidate.id === id)!;
}

describe("withPreset", () => {
  const typed: ProfileDraft = {
    experience: { level: "advanced", role: "advisor" },
    risk: { tolerance: "low", liquidityNeeds: "high" },
    constraints: { allowedInstruments: ["bonds"], exclusions: ["tobacco"] },
    jurisdiction: { country: "DE", baseCurrency: "EUR", accountTypes: ["Depot"] },
    style: { answerLanguage: "German", depth: "brief" },
  };

  it("fills in the preset's fields and keeps every field it does not set", () => {
    const next = withPreset(typed, preset("index-investor"));

    expect(next.experience).toEqual({ level: "beginner", role: "individual" });
    expect(next.risk).toEqual({ tolerance: "moderate", capacityForLoss: "medium", liquidityNeeds: "low" });
    expect(next.constraints).toEqual({ allowedInstruments: ["stocks", "etfs", "funds"], exclusions: ["tobacco"] });
    expect(next.jurisdiction).toEqual(typed.jurisdiction);
    expect(next.style).toMatchObject({ approach: "index", depth: "standard", answerLanguage: "German" });
  });

  it("leaves a group the preset does not mention exactly as it was", () => {
    const next = withPreset(typed, preset("professional-analyst"));

    expect(next.risk).toEqual(typed.risk);
    expect(next.constraints).toEqual(typed.constraints);
    expect(next.objectives).toBeUndefined();
    expect(next.style).toMatchObject({ depth: "deep", answerLanguage: "German" });
  });

  it("applies to an empty draft as the preset itself", () => {
    for (const each of profilePresets) expect(cleanDraft(withPreset({}, each))).toEqual(cleanDraft(each.profile));
  });
});
