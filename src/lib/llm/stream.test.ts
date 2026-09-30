import { type Api, clampThinkingLevel, getSupportedThinkingLevels, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { amazonBedrockProvider } from "@earendil-works/pi-ai/providers/amazon-bedrock";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, defaultConfig } from "@/lib/config/schema";
import { streamModel } from "./stream";
import { transmittedThinking } from "./thinking";
import { runsAs } from "./thinking-clamp";

const streamSimple = vi.fn();
vi.mock("./models", () => ({ getModels: () => ({ streamSimple }), draftModels: () => ({ streamSimple }) }));

function config(): AppConfig {
  const base = defaultConfig();
  base.llm.providers = [
    { id: "anthropic", type: "anthropic", name: "Anthropic", apiKey: "sk-ant", auth: "api_key" },
    { id: "amazon-bedrock", type: "amazon-bedrock", name: "Amazon Bedrock", apiKey: "", method: "access-keys",
      settings: { AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "secret", AWS_REGION: "us-east-1" } },
  ];
  return base;
}

function catalogModel(id: string): Model<Api> {
  const model = anthropicProvider().getModels().find((candidate) => candidate.id === id);
  if (!model) throw new Error(`pi's catalog lost ${id}`);
  return model;
}

/** The reasoning option pi-ai was handed for a request at `level`. */
function sentReasoning(model: Model<Api>, level: SimpleStreamOptions["reasoning"]): SimpleStreamOptions["reasoning"] {
  streamSimple.mockClear();
  streamModel(config(), model, { messages: [] }, { reasoning: level });
  return (streamSimple.mock.calls[0][2] as SimpleStreamOptions).reasoning;
}

beforeEach(() => streamSimple.mockReset());

describe("the reasoning level a request sends", () => {
  it("is clamped as pi-ai clamps it, which its Anthropic API does not do itself", () => {
    // Sonnet 4.6 names max but not xhigh: pi's Anthropic API would send "high" for xhigh.
    const sonnet = catalogModel("claude-sonnet-4-6");
    expect(sentReasoning(sonnet, "xhigh")).toBe("max");
    expect(runsAs("xhigh", getSupportedThinkingLevels(sonnet))).toBe("max");
    expect(transmittedThinking(config().llm.providers[0], sonnet, "xhigh")).toBe('xhigh → max → "max"');
  });

  it("sends an accepted level as it is and any other as pi-ai clamps it, for every Anthropic and Bedrock catalog model", () => {
    for (const model of [...anthropicProvider().getModels(), ...amazonBedrockProvider().getModels()].filter((entry) => entry.reasoning)) {
      const accepted = getSupportedThinkingLevels(model);
      for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"] as const) {
        const clamped = accepted.includes(level) ? level : clampThinkingLevel(model, level);
        const sent = sentReasoning(model, level);
        expect(sent, `${model.id} at ${level}`).toBe(clamped === "off" ? undefined : clamped);
        // What pi-ai receives is a level the model accepts, so its API never maps it on its own.
        if (sent) expect(accepted, `${model.id} at ${level}`).toContain(sent);
      }
    }
    expect(sentReasoning(catalogModel("claude-sonnet-4-6"), "medium")).toBe("medium");
    // Opus 5.5 accepts low to max only: minimal goes up to low, never to pi's Anthropic fallback "high".
    expect(sentReasoning(catalogModel("claude-opus-5-5"), "minimal")).toBe("low");
  });

  it("is recorded as the level sent, with a value only where the catalog names one", () => {
    const provider = config().llm.providers[0];
    const sonnet = catalogModel("claude-sonnet-4-6");
    expect(transmittedThinking(provider, sonnet, "high")).toBe("high");
    expect(transmittedThinking(provider, sonnet, "max")).toBe('max → "max"');
    // Off sends no level: Sonnet 4.6 is switched off, and Opus 5.5, whose effort pi manages, runs at "high".
    expect(transmittedThinking(provider, sonnet, "off")).toBe("off → disabled");
    expect(transmittedThinking(provider, catalogModel("claude-opus-5-5"), "off")).toBe('off → "high"');
  });

  it("sends none when there is no level, or when the model cannot reason", () => {
    expect(sentReasoning(catalogModel("claude-sonnet-4-6"), undefined)).toBeUndefined();
    const plain = { ...catalogModel("claude-sonnet-4-6"), reasoning: false };
    expect(sentReasoning(plain, "high")).toBeUndefined();
  });
});
