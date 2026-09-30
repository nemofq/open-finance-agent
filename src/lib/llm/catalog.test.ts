import { describe, expect, it } from "vitest";
import { llmProviderTypes } from "@/lib/config/schema";
import type { LlmProviderConfig } from "@/lib/config/schema";
import {
  activeSettings,
  catalogEntries,
  createProvider,
  customModelInfo,
  llmProviderCatalog,
  missingSetup,
  newProviderId,
  providerAuthKind,
  takesKey,
} from "./catalog";

describe("customModelInfo", () => {
  it("takes image input from the user's toggle, and leaves it off when unset", () => {
    expect(customModelInfo({ id: "qwen-vl", images: true }).supportsImages).toBe(true);
    expect(customModelInfo({ id: "qwen-vl", images: false }).supportsImages).toBe(false);
    expect(customModelInfo({ id: "qwen-27b" }).supportsImages).toBe(false);
  });

  it("keeps the rest of a hand-listed model as configured", () => {
    expect(customModelInfo({ id: "qwen-27b", name: "Qwen", contextWindow: 32768, reasoning: true, maxTokens: 4096 })).toEqual({
      id: "qwen-27b",
      name: "Qwen",
      contextLength: 32768,
      pricing: { input: 0, output: 0 },
      supportsReasoning: true,
      supportsImages: false,
      maxTokens: 4096,
    });
  });
});

describe("catalogEntries", () => {
  it("features the providers most people come for, in the dialog's order", () => {
    expect(catalogEntries.filter((row) => row.featured).map((row) => [row.id, row.group, row.name])).toEqual([
      ["anthropic:oauth", "signin", "Claude (Pro/Max)"],
      ["openai-codex", "signin", "ChatGPT (Codex)"],
      ["github-copilot", "signin", "GitHub Copilot"],
      ["openrouter", "api_key", "OpenRouter"],
      ["anthropic:api_key", "api_key", "Anthropic"],
      ["openai", "api_key", "OpenAI"],
      ["google", "api_key", "Google Gemini"],
      ["xai:api_key", "api_key", "xAI"],
      ["deepseek", "api_key", "DeepSeek"],
      ["opencode", "api_key", "OpenCode Zen"],
      ["opencode-go", "api_key", "OpenCode Go"],
      ["openai-compatible", "custom", "OpenAI-compatible endpoint"],
    ]);
  });

  it("gives each subscription that shares a type with a key a name of its own", () => {
    const signins = catalogEntries.filter((row) => row.auth === "oauth" && row.authKinds.length > 1);
    expect(signins.map((row) => [row.id, row.name])).toEqual([
      ["anthropic:oauth", "Claude (Pro/Max)"],
      ["xai:oauth", "SuperGrok / X Premium"],
      ["meta:oauth", "Meta (Muse)"],
      ["kimi-coding:oauth", "Kimi Code"],
    ]);
  });

  it("covers every type, and adds a row only for an auth kind that type offers", () => {
    expect(new Set(catalogEntries.map((row) => row.type))).toEqual(new Set(llmProviderTypes));
    for (const row of catalogEntries) expect(llmProviderCatalog[row.type].authKinds).toContain(row.auth);
  });

  it("marks the Claude and Meta subscriptions experimental, and nothing else", () => {
    expect(catalogEntries.filter((row) => row.experimental).map((row) => row.id)).toEqual(["anthropic:oauth", "meta:oauth"]);
  });

  it("asks for a key exactly where one is the way in and is not optional", () => {
    for (const info of Object.values(llmProviderCatalog)) {
      expect(info.keyRequired).toBe(info.authKinds.includes("api_key") && info.type !== "openai-compatible");
    }
  });

  it("gives every setup field a method that asks for it, and names each field once", () => {
    for (const { type, setup } of Object.values(llmProviderCatalog)) {
      if (!setup) continue;
      const methods = new Set(setup.methods?.map((method) => method.id));
      const names = setup.fields.map((field) => field.name);
      expect(new Set(names).size, type).toBe(names.length);
      for (const field of setup.fields) for (const method of field.methods ?? []) expect(methods, type).toContain(method);
    }
  });
});

type Hosted = Extract<LlmProviderConfig, { type: "amazon-bedrock" }>;

const bedrock = (fields: Partial<Hosted> = {}): Hosted => ({
  id: "amazon-bedrock",
  type: "amazon-bedrock",
  name: "Amazon Bedrock",
  apiKey: "",
  ...fields,
});

describe("setup", () => {
  it("asks for the first method's key and every field it needs, one at a time", () => {
    expect(missingSetup(bedrock())).toBe("Add the API key");
    expect(missingSetup(bedrock({ apiKey: "bedrock-key" }))).toBe("Add the region");
    expect(missingSetup(bedrock({ apiKey: "bedrock-key", settings: { AWS_REGION: "us-east-1" } }))).toBeUndefined();
  });

  it("takes no key under a method that has none, and asks for that method's fields instead", () => {
    const profile = bedrock({ method: "profile", apiKey: "stale-key", settings: { AWS_REGION: "eu-west-1" } });
    expect(takesKey(profile)).toBe(false);
    expect(missingSetup(profile)).toBe("Add the profile");
    expect(missingSetup(bedrock({ method: "access-keys", settings: { AWS_ACCESS_KEY_ID: "AKIA" } }))).toBe(
      "Add the secret access key",
    );
  });

  it("hands on only the current method's values, trimmed, and leaves optional ones out when blank", () => {
    const provider = bedrock({
      method: "access-keys",
      settings: {
        AWS_ACCESS_KEY_ID: " AKIA ",
        AWS_SECRET_ACCESS_KEY: "secret",
        AWS_SESSION_TOKEN: "",
        AWS_PROFILE: "left-from-profile",
        AWS_REGION: "us-west-2",
      },
    });
    expect(activeSettings(provider)).toEqual({ AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "secret", AWS_REGION: "us-west-2" });
    expect(missingSetup(provider)).toBeUndefined();
  });

  it("asks a type without methods for its key, then its fields", () => {
    const gateway = (settings: Record<string, string>, apiKey = "cf-token"): LlmProviderConfig => ({
      id: "cloudflare-ai-gateway",
      type: "cloudflare-ai-gateway",
      name: "Cloudflare AI Gateway",
      apiKey,
      settings,
    });
    expect(missingSetup(gateway({}, ""))).toBe("Add an API key");
    expect(missingSetup(gateway({ CLOUDFLARE_ACCOUNT_ID: "acc" }))).toBe("Add the gateway ID");
    expect(missingSetup(gateway({ CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_GATEWAY_ID: "default" }))).toBeUndefined();
  });

  it("asks nothing of a sign-in, whose credential is not in the config", () => {
    expect(missingSetup({ id: "xai", type: "xai", name: "SuperGrok", apiKey: "", auth: "oauth" })).toBeUndefined();
  });
});

describe("createProvider", () => {
  it("builds the instance a sign-in row adds: the pi id, the row's name, no key", () => {
    const row = catalogEntries.find((entry) => entry.id === "anthropic:oauth");
    if (!row) throw new Error("the Claude row is gone");
    expect(createProvider(row, [])).toEqual({
      id: "anthropic",
      type: "anthropic",
      name: "Claude (Pro/Max)",
      apiKey: "",
      auth: "oauth",
    });
  });

  it("gives a key row the auth it adds with, and its type as the id pi stores credentials under", () => {
    const row = catalogEntries.find((entry) => entry.id === "openai");
    if (!row) throw new Error("the OpenAI row is gone");
    expect(createProvider(row, [])).toEqual({ id: "openai", type: "openai", name: "OpenAI", apiKey: "", auth: "api_key" });
  });

  it("refuses to guess an endpoint, which the add dialog builds from its own form", () => {
    const row = catalogEntries.find((entry) => entry.type === "openai-compatible");
    if (!row) throw new Error("the endpoint row is gone");
    expect(() => createProvider(row, [])).toThrow(/own form/);
  });
});

describe("providerAuthKind", () => {
  it("reads a key for an instance saved before the field existed", () => {
    expect(providerAuthKind({ id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: "sk-or" })).toBe("api_key");
    expect(providerAuthKind({ id: "anthropic", type: "anthropic", name: "Claude", apiKey: "", auth: "oauth" })).toBe("oauth");
  });
});

describe("newProviderId", () => {
  it("names a single-instance provider after its type, which is already its pi id", () => {
    expect(newProviderId("openrouter", "OpenRouter", [])).toBe("openrouter");
    // The schema fixes a hosted id to its type, so a taken id cannot be worked around here.
    expect(newProviderId("anthropic", "Claude (Pro/Max)", ["anthropic"])).toBe("anthropic");
  });

  it("gives an endpoint a suffixed id that is free and outside pi-ai's namespace", () => {
    const ids = Array.from({ length: 50 }, () => newProviderId("openai-compatible", "Anthropic", ["anthropic-1234"]));
    for (const id of ids) {
      expect(id).toMatch(/^anthropic-[a-z0-9]{4}$/);
      expect(id).not.toBe("anthropic-1234");
    }
  });
});
