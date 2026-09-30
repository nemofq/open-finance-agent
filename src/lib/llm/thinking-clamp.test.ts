import { type Api, clampThinkingLevel, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { describe, expect, it } from "vitest";
import { thinkingLevels } from "@/lib/config/schema";
import { runsAs } from "./thinking-clamp";

describe("runsAs", () => {
  const models: Model<Api>[] = [anthropicProvider, openaiProvider, openaiCodexProvider].flatMap((provider) => [...provider().getModels()]);

  it("clamps every level above off as pi-ai does, for every model in three catalogs", () => {
    for (const model of models) {
      const supported = getSupportedThinkingLevels(model);
      for (const level of thinkingLevels.filter((candidate) => candidate !== "off")) {
        expect(runsAs(level, supported), `${model.id} at ${level}`).toBe(clampThinkingLevel(model, level));
      }
    }
  });

  it("goes up to the nearest accepted level first, then down", () => {
    expect(runsAs("minimal", ["off", "low", "medium", "high"])).toBe("low");
    expect(runsAs("max", ["off", "minimal", "low", "medium", "high"])).toBe("high");
    expect(runsAs("low", ["medium", "xhigh"])).toBe("medium");
    expect(runsAs("medium", ["off"])).toBe("off");
  });

  it("leaves Off to the provider's default on a model that cannot turn thinking off", () => {
    expect(runsAs("off", ["minimal", "low", "medium", "high"])).toBeNull();
    expect(runsAs("off", ["off", "low"])).toBe("off");
  });
});
