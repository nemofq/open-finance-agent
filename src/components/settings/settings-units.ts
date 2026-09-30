/**
 * Settings pages save one unit at a time: a module entry, one LLM provider, one MCP server, or the
 * LLM defaults. A unit reads and writes its slice of a config, so the same unit edits the draft
 * (`update((c) => unit.write(c, next))`), builds a request from the saved config, and rebases the
 * draft on the server's reply without touching other units' unsaved edits.
 */
import type { AppConfig, LlmProviderConfig, McpServerConfig } from "@/lib/config/schema";
import { deepEqual } from "@/lib/utils";

type LlmConfig = AppConfig["llm"];
export type ModuleConfigEntry = AppConfig["modules"][string];
export type LlmDefaults = Pick<LlmConfig, "defaultModel" | "thinkingLevel">;

export interface SettingsUnit<T> {
  /** Unique per unit, e.g. `module:edgar`; identifies the unit while it saves. */
  key: string;
  /** This unit's value in `config`, or undefined when absent (not added yet, or deleted). */
  read: (config: AppConfig) => T | undefined;
  /** `config` with this unit set to `value`; undefined removes it. */
  write: (config: AppConfig, value: T | undefined) => AppConfig;
}

/** Whether the unit's draft value differs from its saved value. */
export function unitDirty<T>(unit: SettingsUnit<T>, draft: AppConfig, saved: AppConfig): boolean {
  return !deepEqual(unit.read(draft), unit.read(saved));
}

/** `items` with the item `id` replaced by `value` (appended when absent), or removed when `value` is undefined. */
function setById<T extends { id: string }>(items: T[], id: string, value: T | undefined): T[] {
  if (!value) return items.filter((item) => item.id !== id);
  return items.some((item) => item.id === id)
    ? items.map((item) => (item.id === id ? value : item))
    : [...items, value];
}

/** The module entry `config.modules[id]`. */
export function moduleUnit(id: string): SettingsUnit<ModuleConfigEntry> {
  return {
    key: `module:${id}`,
    read: (config) => config.modules[id],
    write: (config, value) => ({
      ...config,
      modules: value
        ? { ...config.modules, [id]: value }
        : Object.fromEntries(Object.entries(config.modules).filter(([key]) => key !== id)),
    }),
  };
}

/** The LLM provider `id`; removing it also clears a default model that used it, as the server does. */
export function llmProviderUnit(id: string): SettingsUnit<LlmProviderConfig> {
  return {
    key: `llm.provider:${id}`,
    read: (config) => config.llm.providers.find((provider) => provider.id === id),
    write: (config, value) => {
      const { defaultModel } = config.llm;
      return {
        ...config,
        llm: {
          ...config.llm,
          providers: setById(config.llm.providers, id, value),
          defaultModel: !value && defaultModel?.provider === id ? null : defaultModel,
        },
      };
    },
  };
}

/** The MCP server `id`. */
export function mcpServerUnit(id: string): SettingsUnit<McpServerConfig> {
  return {
    key: `mcp.server:${id}`,
    read: (config) => config.mcp.servers.find((server) => server.id === id),
    write: (config, value) => ({ ...config, mcp: { ...config.mcp, servers: setById(config.mcp.servers, id, value) } }),
  };
}

/** The default model and thinking level. They cannot be removed, so writing undefined changes nothing. */
export const llmDefaultsUnit: SettingsUnit<LlmDefaults> = {
  key: "llm.defaults",
  read: ({ llm }) => ({ defaultModel: llm.defaultModel, thinkingLevel: llm.thinkingLevel }),
  write: (config, value) => (value ? { ...config, llm: { ...config.llm, ...value } } : config),
};

/**
 * The notices of saved models moved to a successor. Removing them sends an empty list, because the
 * server merges a request onto the config on disk and would keep a list the request leaves out.
 */
export const llmNoticesUnit: SettingsUnit<NonNullable<LlmConfig["modelNotices"]>> = {
  key: "llm.notices",
  read: ({ llm }) => llm.modelNotices,
  write: (config, value) => ({ ...config, llm: { ...config.llm, modelNotices: value ?? [] } }),
};

/** One persisted change: the config to PUT, built from the last saved config, and how the draft adopts the reply. */
export interface UnitChange {
  request: (saved: AppConfig) => AppConfig;
  rebase: (draft: AppConfig, server: AppConfig) => AppConfig;
}

/**
 * Save `value` as the unit. The draft takes the server's copy of the unit (masked secrets, trimmed
 * names) unless the unit was edited after `before`, its draft value when Save was pressed.
 */
export function saveChange<T>(unit: SettingsUnit<T>, value: T, before: T | undefined): UnitChange {
  return {
    request: (saved) => unit.write(saved, value),
    rebase: (draft, server) => (deepEqual(unit.read(draft), before) ? unit.write(draft, unit.read(server)) : draft),
  };
}

/** Remove the unit from the saved config and the draft alike. */
export function removeChange<T>(unit: SettingsUnit<T>): UnitChange {
  return {
    request: (saved) => unit.write(saved, undefined),
    rebase: (draft) => unit.write(draft, undefined),
  };
}

/**
 * Set only `enabled`, leaving the unit's other unsaved edits in the draft. A unit missing from the
 * saved config (a module never saved) is sent as `fallback`, its defaults, with the flag set.
 */
export function enabledChange<T extends { enabled: boolean }>(
  unit: SettingsUnit<T>,
  enabled: boolean,
  fallback?: T,
): UnitChange {
  return {
    request: (saved) => unit.write(saved, { ...(unit.read(saved) ?? fallback), enabled } as T),
    rebase: (draft, server) => {
      const stored = unit.read(server);
      const current = unit.read(draft);
      if (!stored) return draft;
      return unit.write(draft, current ? { ...current, enabled: stored.enabled } : stored);
    },
  };
}
