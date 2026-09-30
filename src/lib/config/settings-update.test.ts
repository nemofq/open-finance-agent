import { describe, expect, it } from "vitest";
import { type AppConfig, defaultConfig } from "./schema";
import { SECRET_MASK, secretPaths } from "./secrets";
import { applySettingsUpdate as applyWith } from "./settings-update";

/** The config's own secret paths; the settings route adds the registered modules' as well. */
const applySettingsUpdate = (existing: AppConfig, incoming: Record<string, unknown>) => applyWith(existing, incoming, secretPaths);

function existing(): AppConfig {
  const cfg = defaultConfig();
  cfg.llm = {
    providers: [
      { id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: "sk-stored" },
      { id: "local-ab12", type: "openai-compatible", name: "Local", apiKey: "", baseUrl: "http://localhost:4000/v1", models: [{ id: "qwen" }] },
    ],
    defaultModel: { provider: "openrouter", model: "a/b" },
    thinkingLevel: "low",
  };
  cfg.modules.tavily = { enabled: true, apiKey: "tvly-stored" };
  cfg.mcp.servers = [
    { id: "alpha", name: "Alpha", enabled: true, transport: "http", url: "https://a", headers: { Authorization: "bearer-a" } },
    { id: "beta", name: "Beta", enabled: false, transport: "stdio", command: "beta", env: { TOKEN: "env-b" } },
  ];
  return cfg;
}

describe("applySettingsUpdate", () => {
  it("keeps the stored provider key when the browser sends back the mask", () => {
    const { providers } = existing().llm;
    const next = applySettingsUpdate(existing(), {
      llm: {
        providers: [{ ...providers[0], apiKey: SECRET_MASK }, providers[1]],
        defaultModel: { provider: "local-ab12", model: "qwen" },
      },
    });
    expect(next.llm.providers[0].apiKey).toBe("sk-stored");
    expect(next.llm.defaultModel).toEqual({ provider: "local-ab12", model: "qwen" });
  });

  it("writes a real provider key through and clears on an empty string", () => {
    const withKey = (apiKey: string) => ({ llm: { providers: [{ ...existing().llm.providers[0], apiKey }] } });
    expect(applySettingsUpdate(existing(), withKey("sk-new")).llm.providers[0].apiKey).toBe("sk-new");
    expect(applySettingsUpdate(existing(), withKey("")).llm.providers[0].apiKey).toBe("");
  });

  it("leaves untouched branches of the config alone", () => {
    const next = applySettingsUpdate(existing(), { llm: { thinkingLevel: "high" } });
    expect(next.llm.thinkingLevel).toBe("high");
    expect(next.llm.defaultModel).toEqual({ provider: "openrouter", model: "a/b" });
    expect(next.llm.providers).toEqual(existing().llm.providers);
    expect(next.modules.tavily.apiKey).toBe("tvly-stored");
    expect(next.mcp.servers).toHaveLength(2);
  });

  it("clears the default model when its provider is deleted", () => {
    const next = applySettingsUpdate(existing(), { llm: { providers: [existing().llm.providers[1]] } });
    expect(next.llm.providers.map((provider) => provider.id)).toEqual(["local-ab12"]);
    expect(next.llm.defaultModel).toBeNull();
  });

  it("keeps a default model whose provider remains, even when the model is not listed", () => {
    const next = applySettingsUpdate(existing(), { llm: { providers: [existing().llm.providers[0]] } });
    expect(next.llm.defaultModel).toEqual({ provider: "openrouter", model: "a/b" });
  });

  it("clears a default model that names a provider which does not exist", () => {
    const next = applySettingsUpdate(existing(), { llm: { defaultModel: { provider: "gone", model: "x" } } });
    expect(next.llm.defaultModel).toBeNull();
  });

  it("unmasks module secrets", () => {
    const next = applySettingsUpdate(existing(), {
      modules: { tavily: { enabled: false, apiKey: SECRET_MASK } },
    });
    expect(next.modules.tavily).toEqual({ enabled: false, apiKey: "tvly-stored" });
  });

  it("matches masked MCP header and env secrets by server id, not position", () => {
    const next = applySettingsUpdate(existing(), {
      mcp: {
        servers: [
          { id: "beta", name: "Beta", enabled: true, transport: "stdio", command: "beta", env: { TOKEN: SECRET_MASK } },
          { id: "alpha", name: "Alpha", enabled: true, transport: "http", url: "https://a", headers: { Authorization: SECRET_MASK } },
        ],
      },
    });
    expect(next.mcp.servers[0].env).toEqual({ TOKEN: "env-b" });
    expect(next.mcp.servers[1].headers).toEqual({ Authorization: "bearer-a" });
  });

  it("replaces the server array wholesale so deletions stick", () => {
    const next = applySettingsUpdate(existing(), { mcp: { servers: [] } });
    expect(next.mcp.servers).toEqual([]);
  });

  it("blanks a masked secret that has no stored counterpart", () => {
    const next = applySettingsUpdate(existing(), {
      mcp: {
        servers: [
          { id: "new", name: "New", enabled: true, transport: "http", url: "https://n", headers: { Authorization: SECRET_MASK } },
        ],
      },
    });
    expect(next.mcp.servers[0].headers).toEqual({ Authorization: "" });
  });

  it("rejects values the schema does not allow", () => {
    expect(() => applySettingsUpdate(existing(), { llm: { thinkingLevel: "extreme" } })).toThrow();
    const badEndpoint = { ...existing().llm.providers[1], baseUrl: "ftp://nope" };
    expect(() => applySettingsUpdate(existing(), { llm: { providers: [badEndpoint] } })).toThrow(/http/);
  });
});
