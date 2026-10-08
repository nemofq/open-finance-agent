import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configPath } from "@/lib/paths";
import { defaultConfig } from "./schema";
import { readConfig, writeConfig } from "./store";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-config-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("readConfig", () => {
  it("creates a default config file on first run", () => {
    expect(readConfig()).toEqual(defaultConfig());
    expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual(defaultConfig());
  });

  it("fills in defaults for fields missing from the file without rewriting it", () => {
    const onDisk = JSON.stringify({ version: 3, llm: { providers: [], defaultModel: null, thinkingLevel: "low" } });
    writeFileSync(configPath(), onDisk);
    const cfg = readConfig();
    expect(cfg.llm.thinkingLevel).toBe("low");
    // Module entries are not filled in: each module resolves its own `defaultConfig` when read.
    expect(cfg.modules).toEqual({});
    expect(readFileSync(configPath(), "utf8")).toBe(onDisk);
  });

  it("reads an Azure provider saved under pi's old id as the renamed one", () => {
    const azure = {
      id: "azure-openai-responses",
      type: "azure-openai-responses",
      name: "Azure OpenAI",
      apiKey: "azure-key",
      settings: { AZURE_OPENAI_BASE_URL: "https://mine.openai.azure.com" },
    };
    const onDisk = JSON.stringify({
      version: 3,
      llm: { providers: [azure], defaultModel: { provider: "azure-openai-responses", model: "gpt-5.6-sol" }, thinkingLevel: "medium" },
    });
    writeFileSync(configPath(), onDisk);
    const cfg = readConfig();
    expect(cfg.llm.providers).toEqual([expect.objectContaining({ id: "azure", type: "azure", apiKey: "azure-key" })]);
    expect(cfg.llm.defaultModel).toEqual({ provider: "azure", model: "gpt-5.6-sol" });
    // The file keeps the old id until the next save writes the new one.
    expect(readFileSync(configPath(), "utf8")).toBe(onDisk);
    writeConfig(cfg);
    expect(JSON.parse(readFileSync(configPath(), "utf8")).llm.providers[0].id).toBe("azure");
  });

  it("refuses a config from an older release and leaves the file alone", () => {
    const v1 = JSON.stringify({ version: 1, llm: { provider: "openrouter", apiKey: "sk-or-1", defaultModel: "a/b" } });
    const v2 = JSON.stringify({ version: 2, llm: { providers: [], defaultModel: null, thinkingLevel: "off" } });
    for (const onDisk of [v1, v2]) {
      writeFileSync(configPath(), onDisk);
      expect(() => readConfig()).toThrow(/reads only version 3\. Move the file aside and restart/);
      expect(readFileSync(configPath(), "utf8")).toBe(onDisk);
    }
  });

  it("reads a hand-written file without a version as the current version", () => {
    writeFileSync(configPath(), JSON.stringify({ llm: { providers: [], defaultModel: null, thinkingLevel: "high" } }));
    expect(readConfig()).toMatchObject({ version: 3, llm: { thinkingLevel: "high" } });
  });

  it("refuses a file that is not valid JSON and leaves it alone", () => {
    const onDisk = '{ "version": 3, "llm": { "providers": [ }';
    writeFileSync(configPath(), onDisk);
    expect(() => readConfig()).toThrow(`${configPath()} is not valid JSON`);
    expect(readFileSync(configPath(), "utf8")).toBe(onDisk);
  });

  it("rejects a file that violates the schema", () => {
    writeFileSync(configPath(), JSON.stringify({ version: 3, llm: { thinkingLevel: "extreme" } }));
    expect(() => readConfig()).toThrow();
  });
});

describe("writeConfig", () => {
  it("writes owner-only and leaves no temporary file behind", () => {
    const cfg = defaultConfig();
    cfg.llm.providers = [{ id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: "sk-secret" }];
    writeConfig(cfg);
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
    expect(readdirSync(home)).not.toContainEqual(expect.stringMatching(/\.tmp$/));
    expect(readConfig().llm.providers[0].apiKey).toBe("sk-secret");
  });
});

describe("provider ids", () => {
  const endpoint = (id: string) => ({
    id,
    type: "openai-compatible" as const,
    name: "Lab",
    apiKey: "",
    baseUrl: "https://llm.example.com/v1",
    models: [],
  });

  it("refuses an endpoint that squats on a pi-ai provider id", () => {
    const cfg = defaultConfig();
    cfg.llm.providers = [endpoint("anthropic")];
    // pi keys credentials by provider id, so an endpoint here would answer for the real provider.
    expect(() => writeConfig(cfg)).toThrow(/reserved/);
  });

  it("keeps a hosted type on the pi id of its own type", () => {
    const cfg = defaultConfig();
    cfg.llm.providers = [{ id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: "sk-or" }, endpoint("lab-a1b2")];
    expect(() => writeConfig(cfg)).not.toThrow();
  });
});
