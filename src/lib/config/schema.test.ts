import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { describe, expect, expectTypeOf, it } from "vitest";
import { hostedLlmProviderTypes, llmAuthKinds, llmProviderTypeFacts } from "@/lib/llm/provider-types";
import { appConfigSchema, customModelSchema, defaultConfig, llmProviderSchema, type ThinkingLevel, thinkingLevels } from "./schema";

describe("thinking levels", () => {
  it("are pi-ai's own, in pi's order", () => {
    // A compile-time check as much as a runtime one: a pi-ai upgrade that adds or drops a level fails the typecheck.
    expectTypeOf<ThinkingLevel>().toEqualTypeOf<ModelThinkingLevel>();
    expect(thinkingLevels).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  });

  it("accept every pi level, including the four configs were saved with before", () => {
    for (const thinkingLevel of thinkingLevels) {
      const config = { ...defaultConfig(), llm: { ...defaultConfig().llm, thinkingLevel } };
      expect(appConfigSchema.safeParse(config).success, thinkingLevel).toBe(true);
    }
    const config = { ...defaultConfig(), llm: { ...defaultConfig().llm, thinkingLevel: "extreme" } };
    expect(appConfigSchema.safeParse(config).success).toBe(false);
  });
});

describe("hosted provider schemas", () => {
  const instance = (type: string, auth?: string) => ({ id: type, type, name: "Mine", apiKey: "", ...(auth ? { auth } : {}) });

  it("accept exactly the auth kinds each type's row offers", () => {
    for (const type of hostedLlmProviderTypes) {
      const offered: readonly string[] = llmProviderTypeFacts(type).authKinds;
      for (const auth of llmAuthKinds) {
        expect(llmProviderSchema.safeParse(instance(type, auth)).success, `${type} with ${auth}`).toBe(offered.includes(auth));
      }
    }
  });

  it("read a missing auth as a key only for a type that offers one", () => {
    // Every instance saved before config v3 had no `auth` and used a key; a sign-in-only type has no such past.
    for (const type of hostedLlmProviderTypes) {
      const offered: readonly string[] = llmProviderTypeFacts(type).authKinds;
      expect(llmProviderSchema.safeParse(instance(type)).success, type).toBe(offered.includes("api_key"));
    }
  });

  it("fix the id to the type", () => {
    expect(llmProviderSchema.safeParse({ ...instance("openai"), id: "openai-2" }).success).toBe(false);
  });

  it("accept the methods and settings a type's row names, and nothing else", () => {
    const bedrock = { ...instance("amazon-bedrock"), method: "profile", settings: { AWS_PROFILE: "dev", AWS_REGION: "us-east-1" } };
    expect(llmProviderSchema.safeParse(bedrock).success).toBe(true);
    expect(llmProviderSchema.safeParse({ ...bedrock, method: "sso" }).success).toBe(false);
    expect(llmProviderSchema.safeParse({ ...bedrock, settings: { AWS_PROFILE: "dev", HOME: "/tmp" } }).success).toBe(false);
    // A type without setup takes no settings at all, so nothing unasked-for reaches pi.
    expect(llmProviderSchema.safeParse({ ...instance("openai"), settings: { OPENAI_BASE_URL: "x" } }).success).toBe(false);
  });
});

describe("custom model thinking", () => {
  it("accepts declared level names and an off mechanism, trimmed", () => {
    const model = customModelSchema.parse({
      id: "Qwen/Qwen3.8-27B",
      reasoning: true,
      thinking: { levels: { low: " low ", medium: "medium", high: "xhigh" }, off: "chat-template" },
    });
    expect(model.thinking).toEqual({ levels: { low: "low", medium: "medium", high: "xhigh" }, off: "chat-template" });
  });

  it("leaves thinking unset when not declared, and accepts a partial block", () => {
    expect(customModelSchema.parse({ id: "m" }).thinking).toBeUndefined();
    expect(customModelSchema.parse({ id: "m", thinking: { off: "none" } }).thinking).toEqual({ off: "none" });
    expect(customModelSchema.parse({ id: "m", thinking: { levels: { high: "xhigh" } } }).thinking).toEqual({
      levels: { high: "xhigh" },
    });
  });

  it("accepts a name for every level above off, and drops a level pi does not have", () => {
    const levels = { minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "very-high", max: "max" };
    expect(customModelSchema.parse({ id: "m", thinking: { levels: { ...levels, off: "none", ultra: "u" } } }).thinking).toEqual({ levels });
  });

  it("rejects an unknown off mechanism and a blank level name", () => {
    expect(customModelSchema.safeParse({ id: "m", thinking: { off: "qwen-chat-template" } }).success).toBe(false);
    expect(customModelSchema.safeParse({ id: "m", thinking: { levels: { high: "  " } } }).success).toBe(false);
  });
});
