import { describe, expect, it } from "vitest";
import { type AppConfig, defaultConfig, type LlmProviderConfig } from "@/lib/config/schema";
import { maskSecrets, SECRET_MASK, secretPaths } from "@/lib/config/secrets";
import { applySettingsUpdate } from "@/lib/config/settings-update";
import { deepEqual } from "@/lib/utils";
import {
  enabledChange,
  llmDefaultsUnit,
  llmNoticesUnit,
  llmProviderUnit,
  mcpServerUnit,
  moduleUnit,
  removeChange,
  saveChange,
  type UnitChange,
  unitDirty,
} from "./settings-units";

const openrouter: LlmProviderConfig = { id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: "sk-stored" };

/** The config on disk. */
function stored(): AppConfig {
  const cfg = defaultConfig();
  cfg.llm = { providers: [openrouter], defaultModel: { provider: "openrouter", model: "a/b" }, thinkingLevel: "low" };
  cfg.modules.tavily = { enabled: false, apiKey: "tvly-stored" };
  cfg.mcp.servers = [{ id: "alpha", name: "Alpha", enabled: true, transport: "http", url: "https://a" }];
  return cfg;
}

/** Mirrors `PUT /api/settings`: merge onto disk, then reply masked. */
class FakeServer {
  disk = stored();
  put(body: AppConfig): AppConfig {
    this.disk = applySettingsUpdate(this.disk, structuredClone(body), secretPaths);
    return maskSecrets(this.disk);
  }
}

interface Client {
  server: FakeServer;
  saved: AppConfig;
  draft: AppConfig;
}

/** A fresh page: the masked config as both saved and draft. */
function client(): Client {
  const server = new FakeServer();
  const saved = maskSecrets(server.disk);
  return { server, saved, draft: structuredClone(saved) };
}

/** Commit `change` the way `useSettings` does. */
function commit(page: Client, change: UnitChange) {
  page.saved = page.server.put(change.request(page.saved));
  page.draft = change.rebase(page.draft, page.saved);
}

describe("units", () => {
  it("replace, append and remove array items by id", () => {
    const unit = mcpServerUnit("alpha");
    const cfg = stored();
    expect(unit.read(unit.write(cfg, { ...cfg.mcp.servers[0], name: "A2" }))?.name).toBe("A2");
    const beta = mcpServerUnit("beta");
    const added = beta.write(cfg, { id: "beta", name: "Beta", enabled: true, transport: "stdio", command: "b" });
    expect(added.mcp.servers.map((server) => server.id)).toEqual(["alpha", "beta"]);
    expect(unit.write(added, undefined).mcp.servers.map((server) => server.id)).toEqual(["beta"]);
  });

  it("clear the default model when its provider is removed", () => {
    expect(llmProviderUnit("openrouter").write(stored(), undefined).llm).toMatchObject({ providers: [], defaultModel: null });
  });

  it("keep a module in place and remove it", () => {
    const unit = moduleUnit("tavily");
    const cfg = stored();
    expect(Object.keys(unit.write(cfg, { enabled: true }).modules)).toEqual(Object.keys(cfg.modules));
    expect(unit.write(cfg, undefined).modules.tavily).toBeUndefined();
  });

  it("scope dirtiness to the unit", () => {
    const saved = stored();
    const draft = llmDefaultsUnit.write(saved, { defaultModel: null, thinkingLevel: "high" });
    expect(unitDirty(llmDefaultsUnit, draft, saved)).toBe(true);
    expect(unitDirty(llmProviderUnit("openrouter"), draft, saved)).toBe(false);
  });
});

describe("saveChange", () => {
  it("sends only the saved unit and keeps other units' unsaved edits", () => {
    const page = client();
    const tavily = moduleUnit("tavily");
    page.draft = tavily.write(page.draft, { enabled: true, apiKey: "tvly-new" });
    page.draft = llmDefaultsUnit.write(page.draft, { defaultModel: null, thinkingLevel: "high" });

    commit(page, saveChange(tavily, tavily.read(page.draft)!, tavily.read(page.draft)));

    expect(page.server.disk.modules.tavily).toEqual({ enabled: true, apiKey: "tvly-new" });
    expect(page.server.disk.llm.thinkingLevel).toBe("low");
    expect(tavily.read(page.draft)).toEqual({ enabled: true, apiKey: SECRET_MASK });
    expect(unitDirty(tavily, page.draft, page.saved)).toBe(false);
    expect(llmDefaultsUnit.read(page.draft)).toEqual({ defaultModel: null, thinkingLevel: "high" });
  });

  it("keeps edits made to the unit while it was saving", () => {
    const page = client();
    const unit = moduleUnit("tavily");
    page.draft = unit.write(page.draft, { enabled: false, apiKey: "tvly-1" });
    const change = saveChange(unit, unit.read(page.draft)!, unit.read(page.draft));
    page.draft = unit.write(page.draft, { enabled: false, apiKey: "tvly-12" });

    commit(page, change);

    expect(page.server.disk.modules.tavily.apiKey).toBe("tvly-1");
    expect(unit.read(page.draft)?.apiKey).toBe("tvly-12");
    expect(unitDirty(unit, page.draft, page.saved)).toBe(true);
  });

  it("adds an item from a dialog to the saved config and the draft", () => {
    const page = client();
    const unit = llmProviderUnit("local");
    const provider: LlmProviderConfig = {
      id: "local",
      type: "openai-compatible",
      name: " Local ",
      apiKey: "k",
      baseUrl: "http://x/v1",
      models: [],
    };

    commit(page, saveChange(unit, provider, unit.read(page.draft)));

    expect(page.server.disk.llm.providers.map((item) => item.id)).toEqual(["openrouter", "local"]);
    expect(unit.read(page.draft)).toMatchObject({ name: "Local", apiKey: SECRET_MASK });
    expect(unitDirty(unit, page.draft, page.saved)).toBe(false);
  });

  it("builds each request from the latest reply, so back-to-back saves both land", () => {
    const page = client();
    const alpha = mcpServerUnit("alpha");
    page.draft = alpha.write(page.draft, { ...alpha.read(page.draft)!, name: "Alpha 2" });
    page.draft = llmDefaultsUnit.write(page.draft, { defaultModel: null, thinkingLevel: "medium" });
    const first = saveChange(alpha, alpha.read(page.draft)!, alpha.read(page.draft));
    const second = saveChange(llmDefaultsUnit, llmDefaultsUnit.read(page.draft)!, llmDefaultsUnit.read(page.draft));

    commit(page, first);
    commit(page, second);

    expect(page.server.disk.mcp.servers[0].name).toBe("Alpha 2");
    expect(page.server.disk.llm.thinkingLevel).toBe("medium");
    expect(deepEqual(page.draft, page.saved)).toBe(true);
  });
});

describe("removeChange", () => {
  it("removes the item everywhere and adopts the cleared default", () => {
    const page = client();
    const alpha = mcpServerUnit("alpha");
    page.draft = alpha.write(page.draft, { ...alpha.read(page.draft)!, name: "Unsaved" });

    commit(page, removeChange(llmProviderUnit("openrouter")));

    expect(page.server.disk.llm).toMatchObject({ providers: [], defaultModel: null });
    expect(page.draft.llm).toMatchObject({ providers: [], defaultModel: null });
    expect(unitDirty(llmDefaultsUnit, page.draft, page.saved)).toBe(false);
    expect(alpha.read(page.draft)?.name).toBe("Unsaved");
  });
});

describe("removeChange of the model notices", () => {
  it("clears them on disk, which a request leaving them out would not", () => {
    const page = client();
    const notice = { provider: "OpenRouter", from: { name: "A", pricing: { input: 1, output: 2 } }, to: { name: "B", pricing: { input: 1, output: 2 } }, uses: ["the default model"] };
    page.server.disk.llm.modelNotices = [notice];
    page.saved = maskSecrets(page.server.disk);
    page.draft = structuredClone(page.saved);

    commit(page, removeChange(llmNoticesUnit));

    expect(page.server.disk.llm.modelNotices).toEqual([]);
    expect(page.draft.llm.modelNotices).toEqual([]);
  });
});

describe("enabledChange", () => {
  it("persists only the flag and keeps the card's other unsaved fields", () => {
    const page = client();
    const unit = mcpServerUnit("alpha");
    page.draft = unit.write(page.draft, { ...unit.read(page.draft)!, url: "https://unsaved" });

    commit(page, enabledChange(unit, false));

    expect(page.server.disk.mcp.servers[0]).toMatchObject({ enabled: false, url: "https://a" });
    expect(unit.read(page.draft)).toMatchObject({ enabled: false, url: "https://unsaved" });
    expect(unit.read(page.saved)?.enabled).toBe(false);
  });

  it("sends the defaults, not the unsaved draft, for a module that was never saved", () => {
    const page = client();
    const unit = moduleUnit("newcomer");
    page.draft = unit.write(page.draft, { enabled: false, region: "eu" });

    commit(page, enabledChange(unit, true, { enabled: false, region: "us" }));

    expect(page.server.disk.modules.newcomer).toEqual({ enabled: true, region: "us" });
    expect(unit.read(page.draft)).toEqual({ enabled: true, region: "eu" });
    expect(unitDirty(unit, page.draft, page.saved)).toBe(true);
  });
});
