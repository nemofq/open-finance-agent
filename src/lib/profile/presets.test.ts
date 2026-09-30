import { describe, expect, it } from "vitest";
import { profilePresets } from "./presets";
import { profileInputSchema } from "./schema";

describe("profile presets", () => {
  it("offers the four starting points, with unique ids", () => {
    expect(profilePresets.map((preset) => preset.id)).toEqual([
      "index-investor",
      "dividend-income",
      "active-stock-picker",
      "professional-analyst",
    ]);
    expect(new Set(profilePresets.map((preset) => preset.id)).size).toBe(profilePresets.length);
  });

  it("holds a valid, named, described profile that leaves jurisdiction to the user", () => {
    for (const preset of profilePresets) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(profileInputSchema.parse(preset.profile)).toEqual(preset.profile);
      expect(preset.profile.jurisdiction).toBeUndefined();
    }
  });
});
