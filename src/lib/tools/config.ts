/**
 * A module's settings as everything reads them: its own `defaultConfig` under whatever config.json
 * saved for it. The module's `defaultConfig` is the only copy of its defaults, so a module that has
 * never been saved is on or off exactly as it declares, in the agent and on the settings page alike.
 *
 * Browser-safe: types only, no I/O, so the settings UI and the server share one rule.
 */
import type { AppConfig } from "@/lib/config/schema";
import type { Module } from "./contracts";

/** The saved `config.modules` block, or the part of it a masked settings response carries. */
export type SavedModules = Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>;

/** What resolving needs from a module; a `ModuleSummary` has it too. */
export type ModuleDefaults = Pick<Module, "id" | "defaultConfig">;

/** Saved fields win; a field never saved, or a module never saved at all, falls back to its default. */
export function moduleSettings(saved: SavedModules | undefined, module: ModuleDefaults): Record<string, unknown> {
  return { ...module.defaultConfig, ...saved?.[module.id] };
}

/** What a module is built from: its settings, and whatever it keeps elsewhere in config.json. */
export function moduleConfig(config: AppConfig, module: Pick<Module, "id" | "defaultConfig" | "extraConfig">): Record<string, unknown> {
  const own = moduleSettings(config.modules, module);
  return module.extraConfig ? { ...own, ...module.extraConfig(config) } : own;
}

export function moduleEnabled(saved: SavedModules | undefined, module: ModuleDefaults): boolean {
  return moduleSettings(saved, module).enabled === true;
}

/** What `moduleSecretPaths` needs from a module. */
export type ModuleSecretFields = Pick<Module, "id" | "settings">;

/** `modules.<id>.<key>` for every settings field a module declares as a secret, whatever its key. */
export function moduleSecretPaths(modules: readonly ModuleSecretFields[]): string[] {
  return modules.flatMap((module) =>
    module.settings.filter((field) => field.type === "secret").map((field) => `modules.${module.id}.${field.key}`),
  );
}

/*
 * Reading one field of a module's settings. config.json is hand-editable and a field may be missing
 * or of the wrong type, so each reader says what it makes of anything else.
 */

/** A text or secret field, trimmed; "" when it is unset or not text. */
export function settingString(cfg: Readonly<Record<string, unknown>>, key: string): string {
  const value = cfg[key];
  return typeof value === "string" ? value.trim() : "";
}

/** A multiselect field's strings; `fallback` when it is unset or not a list. */
export function settingList(cfg: Readonly<Record<string, unknown>>, key: string, fallback: readonly string[] = []): string[] {
  const value = cfg[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [...fallback];
}

/**
 * A numeric field, typed in a text box and so often a string; undefined when it is unset, blank or
 * not a finite number. A cleared box means "the default", never zero.
 */
export function settingNumber(cfg: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = cfg[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/*
 * Whether a module has what it needs. `required` on a settings field is otherwise only a hint to the
 * form; these read it to tell whether a module has been given what it needs to run.
 */

/** What the readiness checks need from a module; a `ModuleSummary` has it too. */
export type ModuleRequirements = Pick<Module, "id" | "defaultConfig" | "settings">;

/** The module's required text and secret fields; other field types always hold some value. */
function requiredKeys(module: Pick<Module, "settings">): string[] {
  return module.settings
    .filter((field) => field.required === true && (field.type === "text" || field.type === "secret"))
    .map((field) => field.key);
}

/** Every required text or secret field holds a value; a stored secret, masked for the browser, counts. */
export function requiredFieldsFilled(module: Pick<Module, "settings">, cfg: Readonly<Record<string, unknown>>): boolean {
  return requiredKeys(module).every((key) => settingString(cfg, key) !== "");
}

/** A module named for the user, with the id code matches on. */
export interface ModuleLabel {
  id: string;
  name: string;
}

/** On, and every required field filled in. */
export function moduleReady(module: ModuleRequirements, saved: SavedModules | undefined): boolean {
  const cfg = moduleSettings(saved, module);
  return cfg.enabled === true && requiredFieldsFilled(module, cfg);
}

/**
 * Whether saving `draft` should also turn the module on: it is off, and this save is what fills in
 * its required fields. A module turned off while its fields were already saved stays off, and one
 * with no required fields is never switched on by a save.
 */
export function enablesOnSave(module: ModuleRequirements, saved: SavedModules | undefined, draft: SavedModules | undefined): boolean {
  if (requiredKeys(module).length === 0) return false;
  const next = moduleSettings(draft, module);
  return next.enabled !== true && !requiredFieldsFilled(module, moduleSettings(saved, module)) && requiredFieldsFilled(module, next);
}
