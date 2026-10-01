import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectTools, enabledModules, hasDataConnection, isEnabled } from "@/lib/agent/modules";
import { defaultConfig } from "@/lib/config/schema";
import { readConfig } from "@/lib/config/store";
import { configPath } from "@/lib/paths";
import { mcpModule } from "@/lib/providers/mcp/module";
import { SECRET_MASK } from "@/lib/config/secrets";
import { alphaVantageModule } from "@/lib/providers/alphavantage/module";
import { edgarModule } from "@/lib/providers/edgar/module";
import { reportsModule } from "@/lib/reports/tool";
import {
  enablesOnSave,
  moduleConfig,
  moduleEnabled,
  moduleSecretPaths,
  moduleSettings,
  requiredFieldsFilled,
  settingList,
  settingNumber,
  settingString,
} from "./config";
import type { Module } from "./contracts";
import { builtinModules, toModuleSummary } from "./registry";
import { offlineContext } from "./testing";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-module-config-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

/** What `createTools` was handed, per call. */
let received: Record<string, unknown>[] = [];

/** A module that config.json has never heard of, as a newly added provider is on an existing install. */
const newcomer: Module = {
  id: "newcomer",
  name: "Newcomer",
  kind: "data-provider",
  description: "Added after config.json was written.",
  settings: [{ key: "region", label: "Region", type: "text" }],
  defaultConfig: { enabled: true, region: "us", limit: 5 },
  async createTools(cfg) {
    received.push(cfg);
    return [];
  },
};

describe("module settings", () => {
  it("resolve a module missing from config.json from its own defaults", async () => {
    received = [];
    await collectTools(defaultConfig(), [newcomer], offlineContext());
    expect(received).toEqual([{ enabled: true, region: "us", limit: 5 }]);
    expect(moduleSettings({}, toModuleSummary(newcomer))).toEqual({ enabled: true, region: "us", limit: 5 });
  });

  it("let saved fields win over defaults, field by field", async () => {
    received = [];
    const config = defaultConfig();
    config.modules.newcomer = { enabled: false, region: "eu" };
    await collectTools(config, [newcomer], offlineContext());
    expect(received).toEqual([{ enabled: false, region: "eu", limit: 5 }]);
    expect(moduleEnabled(config.modules, newcomer)).toBe(false);
  });

  it("hand a module what it keeps outside config.modules, as the MCP servers module keeps its servers", async () => {
    received = [];
    const config = defaultConfig();
    const server = { id: "wiki", name: "Wiki", enabled: false, transport: "http" as const, url: "https://wiki.test/mcp" };
    config.mcp.servers = [server];
    await collectTools(config, [{ ...newcomer, extraConfig: (saved) => ({ servers: saved.mcp.servers }) }], offlineContext());
    expect(received).toEqual([{ enabled: true, region: "us", limit: 5, servers: [server] }]);
    expect(moduleConfig(config, mcpModule)).toEqual({ enabled: true, servers: [server] });
  });

  it("agree between the agent and the settings page for every built-in module on a fresh install", () => {
    const config = defaultConfig();
    const agent = new Set(enabledModules(config).map((module) => module.id));
    for (const entry of builtinModules) {
      // What the settings card renders from the `/api/settings/modules` summary and the masked config.
      const card = moduleSettings(config.modules, toModuleSummary(entry));
      expect(card.enabled, entry.id).toBe(entry.defaultConfig.enabled);
      expect(agent.has(entry.id), entry.id).toBe(card.enabled);
      expect(isEnabled(config, entry.id), entry.id).toBe(card.enabled);
    }
    expect(agent).toContain("edgar");
    expect(agent).not.toContain("tavily");
  });

  it("read an existing config.json that names only some modules", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        version: 3,
        llm: { providers: [], defaultModel: null, thinkingLevel: "off" },
        modules: { edgar: { enabled: false, contact: "me@example.com" }, tavily: { enabled: true, apiKey: "tvly" } },
        mcp: { servers: [] },
      }),
    );
    const config = readConfig();
    expect(isEnabled(config, "edgar")).toBe(false);
    expect(isEnabled(config, "tavily")).toBe(true);
    // Never saved, so on by its own default.
    expect(isEnabled(config, "python")).toBe(true);
    expect(isEnabled(config, "alphavantage")).toBe(false);
    expect(isEnabled(config, "no-such-module")).toBe(false);
  });
});

describe("hasDataConnection", () => {
  const save = (config: object) => writeFileSync(configPath(), JSON.stringify({ version: 3, ...config }));
  const noProviders = { edgar: { enabled: false }, quotes: { enabled: false }, alphavantage: { enabled: false } };
  const server = { id: "wiki", name: "Wiki", enabled: true, transport: "http", url: "https://wiki.test/mcp" };

  it("counts an enabled data provider module, as EDGAR is on a fresh install", () => {
    expect(hasDataConnection()).toBe(true);
  });

  it("counts an enabled MCP server only when it is marked as a data connection", () => {
    save({ modules: noProviders, mcp: { servers: [server] } });
    expect(hasDataConnection()).toBe(false);
    save({ modules: noProviders, mcp: { servers: [{ ...server, class: "data" }] } });
    expect(hasDataConnection()).toBe(true);
    save({ modules: noProviders, mcp: { servers: [{ ...server, class: "data", enabled: false }] } });
    expect(hasDataConnection()).toBe(false);
  });

  it("does not know when config.json cannot be read", () => {
    writeFileSync(configPath(), "{ not json");
    expect(hasDataConnection()).toBeUndefined();
  });
});

describe("enablesOnSave", () => {
  const off = (fields: object) => ({ alphavantage: { enabled: false, ...fields } });

  it("turns a module on when the save fills in the key it was missing", () => {
    expect(enablesOnSave(alphaVantageModule, off({ apiKey: "" }), off({ apiKey: "av-key" }))).toBe(true);
    // Never saved at all: the defaults leave the key empty.
    expect(enablesOnSave(alphaVantageModule, {}, off({ apiKey: "av-key" }))).toBe(true);
  });

  it("leaves off a module whose key was already stored, as one the user turned off", () => {
    expect(enablesOnSave(alphaVantageModule, off({ apiKey: SECRET_MASK }), off({ apiKey: SECRET_MASK }))).toBe(false);
    expect(enablesOnSave(alphaVantageModule, off({ apiKey: SECRET_MASK }), off({ apiKey: "av-other" }))).toBe(false);
  });

  it("has nothing to do for a module that is already on", () => {
    const on = { alphavantage: { enabled: true, apiKey: "av-key" } };
    expect(enablesOnSave(alphaVantageModule, off({ apiKey: "" }), on)).toBe(false);
  });

  it("never turns on a module without required fields", () => {
    expect(enablesOnSave(reportsModule, { reports: { enabled: false } }, { reports: { enabled: false, format: "pdf" } })).toBe(false);
  });

  it("does not count whitespace as a value", () => {
    expect(enablesOnSave(alphaVantageModule, off({ apiKey: "" }), off({ apiKey: "   " }))).toBe(false);
  });

  it("turns EDGAR on once its contact is filled in", () => {
    const edgar = (contact: string) => ({ edgar: { enabled: false, contact } });
    expect(enablesOnSave(edgarModule, edgar(""), edgar("Jane Doe jane@example.com"))).toBe(true);
  });

  it("reads only required text and secret fields", () => {
    const mixed = {
      id: "mixed",
      defaultConfig: { enabled: false },
      settings: [
        { key: "token", label: "Token", type: "secret" as const, required: true },
        { key: "mode", label: "Mode", type: "select" as const, required: true },
        { key: "extra", label: "Extra", type: "toggle" as const, required: true },
        { key: "note", label: "Note", type: "text" as const },
      ],
    };
    expect(requiredFieldsFilled(mixed, { token: "t" })).toBe(true);
    expect(enablesOnSave(mixed, {}, { mixed: { enabled: false, token: "t" } })).toBe(true);
  });
});

describe("moduleSecretPaths", () => {
  it("names every secret field of every module, whatever its key", () => {
    const modules = [
      { id: "vault", settings: [{ key: "token", label: "Token", type: "secret" as const }, { key: "region", label: "Region", type: "text" as const }] },
      { id: "open", settings: [] },
      { id: "keyed", settings: [{ key: "apiKey", label: "Key", type: "secret" as const }] },
    ];
    expect(moduleSecretPaths(modules)).toEqual(["modules.vault.token", "modules.keyed.apiKey"]);
  });
});

describe("setting readers", () => {
  it("read a text field trimmed, and anything else as empty", () => {
    expect(settingString({ apiKey: "  key " }, "apiKey")).toBe("key");
    expect(settingString({ apiKey: 42 }, "apiKey")).toBe("");
    expect(settingString({}, "apiKey")).toBe("");
  });

  it("read a list field's strings, and fall back when it is not a list", () => {
    expect(settingList({ tools: ["A", 1, "B"] }, "tools", ["X"])).toEqual(["A", "B"]);
    expect(settingList({ tools: [] }, "tools", ["X"])).toEqual([]);
    expect(settingList({ tools: "A" }, "tools", ["X"])).toEqual(["X"]);
    expect(settingList({}, "tools")).toEqual([]);
  });

  it("read a number or a numeric string, and a blank or anything else as unset", () => {
    expect(settingNumber({ ttl: 900 }, "ttl")).toBe(900);
    expect(settingNumber({ ttl: " 60 " }, "ttl")).toBe(60);
    expect(settingNumber({ ttl: "0" }, "ttl")).toBe(0);
    expect(settingNumber({ ttl: "" }, "ttl")).toBeUndefined();
    expect(settingNumber({ ttl: "soon" }, "ttl")).toBeUndefined();
    expect(settingNumber({ ttl: null }, "ttl")).toBeUndefined();
    expect(settingNumber({ ttl: true }, "ttl")).toBeUndefined();
    expect(settingNumber({ ttl: Number.POSITIVE_INFINITY }, "ttl")).toBeUndefined();
  });
});
