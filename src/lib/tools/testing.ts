/**
 * The module contract as test helpers, so `registry.test.ts` and a new provider's own test check
 * the same rules. Each check returns the problems it found; a test asserts the list is empty, which
 * names every broken tool at once instead of stopping at the first.
 */
import type { AppConfig } from "@/lib/config/schema";
import { createLedger } from "@/lib/evidence/ledger";
import type { FinanceTool, Module, ModuleContext, ToolClass, ToolEffect } from "./contracts";
import { builtinModules } from "./registry";

const toolClasses: readonly ToolClass[] = ["data", "finance", "general"];
const toolEffects: readonly ToolEffect[] = ["read", "compute", "write-local", "external"];

/**
 * Tools that are not data connections and still declare a source. `read_attachment` returns what
 * the user attached: sourced, so a figure quoted from it is matchable (rule P8), but the user is
 * not a provider we query, so it is not a connection either.
 */
const sourcedGeneralTools = new Set(["read_attachment"]);

/** A module's defaults, enabled, with a placeholder for the fields it refuses to start without. */
export function offlineConfig(module: Module): Record<string, unknown> {
  const cfg: Record<string, unknown> = { ...module.defaultConfig, enabled: true };
  for (const field of module.settings) {
    if (!field.required) continue;
    if (field.type !== "secret" && field.type !== "text") continue;
    if (typeof cfg[field.key] === "string" && cfg[field.key] !== "") continue;
    cfg[field.key] = "test";
  }
  return cfg;
}

/** A tool-building context with an empty in-memory ledger and a silent log. */
export function offlineContext(extra: Partial<ModuleContext> = {}): ModuleContext {
  return { log: () => undefined, session: { id: "test" }, evidence: createLedger({ sessionId: "test" }), ...extra };
}

/** What the settings page and the agent need from a module before any tool is built. */
export function moduleProblems(module: Module): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(module.id)) problems.push(`${module.id}: id must be lowercase letters, digits or hyphens`);
  if (!module.name.trim()) problems.push(`${module.id}: name is empty`);
  if (!module.description.trim()) problems.push(`${module.id}: description is empty`);
  if (typeof module.defaultConfig.enabled !== "boolean") problems.push(`${module.id}: defaultConfig.enabled must be a boolean`);
  const keys = module.settings.map((field) => field.key);
  for (const key of new Set(keys.filter((key, index) => keys.indexOf(key) !== index))) {
    problems.push(`${module.id}: settings key ${key} is repeated`);
  }
  for (const field of module.settings) {
    if (!(field.key in module.defaultConfig)) problems.push(`${module.id}: settings field ${field.key} has no default in defaultConfig`);
    if ((field.type === "select" || field.type === "multiselect") && !field.options?.length) {
      problems.push(`${module.id}: ${field.type} field ${field.key} has no options`);
    }
  }
  return problems;
}

/**
 * Every tool declares a class and an effect; a data tool names its source with a tier and the
 * domains it covers, and nothing else claims a source.
 */
export function toolProblems(tools: FinanceTool[]): string[] {
  const problems: string[] = [];
  for (const tool of tools) {
    if (!toolClasses.includes(tool.meta.class)) problems.push(`${tool.name}: unknown class ${String(tool.meta.class)}`);
    if (!toolEffects.includes(tool.meta.effect)) problems.push(`${tool.name}: unknown effect ${String(tool.meta.effect)}`);
    const source = tool.meta.source;
    if (tool.meta.class !== "data" && !sourcedGeneralTools.has(tool.name)) {
      if (source) problems.push(`${tool.name}: only a data tool declares a source`);
      continue;
    }
    if (!source) {
      problems.push(`${tool.name}: a data tool needs meta.source`);
      continue;
    }
    if (!source.id) problems.push(`${tool.name}: source id is empty`);
    if (!source.name) problems.push(`${tool.name}: source name is empty`);
    if (![1, 2, 3, 4].includes(source.tier)) problems.push(`${tool.name}: source tier ${String(source.tier)} is not 1 to 4`);
    // Only a connection declares coverage; a file the user attached covers nothing in particular.
    if (tool.meta.class === "data" && source.coverage.length === 0) problems.push(`${tool.name}: a data tool declares its coverage`);
  }
  return problems;
}

/**
 * `config` with every built-in module saved as off, so a test turns on only what it names. A
 * module missing from config.json runs on its own defaults, several of which are on, so emptying
 * `config.modules` is not the same thing.
 */
export function withModulesOff(config: AppConfig, except: readonly string[] = []): AppConfig {
  for (const entry of builtinModules) {
    config.modules[entry.id] = { ...entry.defaultConfig, ...config.modules[entry.id], enabled: except.includes(entry.id) };
  }
  return config;
}
