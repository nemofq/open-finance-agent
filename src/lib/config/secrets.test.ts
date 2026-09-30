import { describe, expect, it } from "vitest";
import { defaultConfig } from "./schema";
import { maskSecrets, restoreSecrets, SECRET_MASK } from "./secrets";

describe("secret masking", () => {
  const withSecrets = () => {
    const cfg = defaultConfig();
    cfg.llm.providers = [
      { id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: "sk-llm" },
      { id: "local-ab12", type: "openai-compatible", name: "Local", apiKey: "", baseUrl: "http://localhost:4000/v1", models: [] },
      { id: "gateway-cd34", type: "openai-compatible", name: "Gateway", apiKey: "gw-key", baseUrl: "https://gw.example/v1", models: [] },
    ];
    cfg.modules.tavily = { enabled: false, apiKey: "tvly-key" };
    cfg.modules.alphavantage = { enabled: false, apiKey: "" };
    cfg.mcp.servers = [
      {
        id: "srv-a",
        name: "A",
        enabled: true,
        transport: "http",
        url: "https://a.example",
        headers: { Authorization: "Bearer a" },
      },
      {
        id: "srv-b",
        name: "B",
        enabled: true,
        transport: "stdio",
        command: "node",
        env: { TOKEN: "b-token" },
      },
    ];
    return cfg;
  };

  it("masks non-empty secrets and leaves empty ones alone", () => {
    const masked = maskSecrets(withSecrets());
    expect(masked.llm.providers.map((provider) => provider.apiKey)).toEqual([SECRET_MASK, "", SECRET_MASK]);
    expect(masked.modules.tavily.apiKey).toBe(SECRET_MASK);
    expect(masked.modules.alphavantage.apiKey).toBe("");
    expect(masked.mcp.servers[0].headers?.Authorization).toBe(SECRET_MASK);
    expect(masked.mcp.servers[1].env?.TOKEN).toBe(SECRET_MASK);
    expect(masked.mcp.servers[0].url).toBe("https://a.example");
  });

  it("round-trips masked values back to the stored secrets", () => {
    const stored = withSecrets();
    expect(restoreSecrets(maskSecrets(stored), stored)).toEqual(stored);
  });

  it("keeps secrets attached to their server when the list is reordered", () => {
    const stored = withSecrets();
    const incoming = maskSecrets(stored);
    incoming.mcp.servers.reverse();
    const merged = restoreSecrets(incoming, stored);
    expect(merged.mcp.servers[0].env?.TOKEN).toBe("b-token");
    expect(merged.mcp.servers[1].headers?.Authorization).toBe("Bearer a");
  });

  it("keeps provider keys attached to their provider across reorders and deletions", () => {
    const stored = withSecrets();
    const incoming = maskSecrets(stored);
    incoming.llm.providers = [incoming.llm.providers[2], incoming.llm.providers[1]];
    const merged = restoreSecrets(incoming, stored);
    expect(merged.llm.providers.map((provider) => [provider.id, provider.apiKey])).toEqual([
      ["gateway-cd34", "gw-key"],
      ["local-ab12", ""],
    ]);
  });

  it("takes an edited secret over the stored one", () => {
    const stored = withSecrets();
    const incoming = maskSecrets(stored);
    incoming.llm.providers[0].apiKey = "sk-new";
    expect(restoreSecrets(incoming, stored).llm.providers[0].apiKey).toBe("sk-new");
  });

  it("restores only the paths it is given, as a module's own secret fields", () => {
    const stored = { enabled: true, token: "vault-token", region: "eu" };
    const incoming = { enabled: false, token: SECRET_MASK, region: SECRET_MASK };
    expect(restoreSecrets(incoming, stored, ["token"])).toEqual({ enabled: false, token: "vault-token", region: SECRET_MASK });
  });

  it("resolves a mask with no stored counterpart to an empty string", () => {
    const incoming = withSecrets();
    incoming.llm.providers[2] = {
      id: "gateway-ef56",
      type: "openai-compatible",
      name: "Gateway",
      apiKey: SECRET_MASK,
      baseUrl: "https://gw.example/v1",
      models: [],
    };
    expect(restoreSecrets(incoming, withSecrets()).llm.providers[2].apiKey).toBe("");
  });
});
