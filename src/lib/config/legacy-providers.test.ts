import { describe, expect, it } from "vitest";
import { currentModelRef, currentProviderId, renameLegacyProviders } from "./legacy-providers";

describe("currentProviderId", () => {
  it("maps pi's old Azure id to the new one and leaves every other id alone", () => {
    expect(currentProviderId("azure-openai-responses")).toBe("azure");
    expect(currentProviderId("azure")).toBe("azure");
    expect(currentProviderId("openai-codex")).toBe("openai-codex");
    expect(currentProviderId("my-endpoint")).toBe("my-endpoint");
  });
});

describe("currentModelRef", () => {
  it("renames a saved ref's provider and returns an unchanged ref as it is", () => {
    expect(currentModelRef({ provider: "azure-openai-responses", model: "gpt-6-sol" })).toEqual({ provider: "azure", model: "gpt-6-sol" });
    const ref = { provider: "deepseek", model: "deepseek-flash" };
    expect(currentModelRef(ref)).toBe(ref);
  });
});

describe("renameLegacyProviders", () => {
  it("renames the provider and the default model that point at the old id, and nothing else", () => {
    const onDisk = {
      version: 3,
      llm: {
        providers: [
          { id: "azure-openai-responses", type: "azure-openai-responses", name: "Azure OpenAI", apiKey: "k" },
          { id: "deepseek", type: "deepseek", name: "DeepSeek", apiKey: "d" },
        ],
        defaultModel: { provider: "azure-openai-responses", model: "gpt-6-sol" },
        thinkingLevel: "medium",
      },
      modules: { edgar: { enabled: true } },
    };
    expect(renameLegacyProviders(onDisk)).toEqual({
      ...onDisk,
      llm: {
        ...onDisk.llm,
        providers: [{ id: "azure", type: "azure", name: "Azure OpenAI", apiKey: "k" }, onDisk.llm.providers[1]],
        defaultModel: { provider: "azure", model: "gpt-6-sol" },
      },
    });
  });

  it("passes through anything not shaped like a config, for the schema to report", () => {
    expect(renameLegacyProviders(null)).toBeNull();
    expect(renameLegacyProviders({ version: 3 })).toEqual({ version: 3 });
    expect(renameLegacyProviders({ llm: { providers: "nope", defaultModel: null } })).toEqual({ llm: { providers: "nope", defaultModel: null } });
  });
});
