import { readFileSync } from "node:fs";
import { isMissingFile, writeFileAtomicSync } from "@/lib/atomic-write";
import { configPath, ensureDataDirs } from "@/lib/paths";
import { deepMerge, isRecord } from "@/lib/utils";
import { type AppConfig, appConfigSchema, CONFIG_VERSION, defaultConfig } from "./schema";

/**
 * Refuse a config.json from another release rather than read its settings as if they were this
 * one's. A file written by hand may leave `version` out; it is then read as the current version.
 */
function checkVersion(onDisk: unknown): void {
  const version = isRecord(onDisk) ? onDisk.version : undefined;
  if (version === undefined || version === CONFIG_VERSION) return;
  throw new Error(
    `${configPath()} is version ${JSON.stringify(version)}, but this release reads only version ${CONFIG_VERSION}. ` +
      "Move the file aside and restart to create a new one, then enter your settings again.",
  );
}

/** Read config.json, filling in defaults. Creates the file on first run. */
export function readConfig(): AppConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath(), "utf8");
  } catch (err) {
    if (!isMissingFile(err)) throw err;
    const fresh = defaultConfig();
    writeConfig(fresh);
    return fresh;
  }
  // A hand edit with a typo must not be replaced by defaults: that would lose every key in it.
  let onDisk: unknown;
  try {
    onDisk = JSON.parse(raw);
  } catch {
    throw new Error(`${configPath()} is not valid JSON. Fix the file or move it aside and restart to create a new one.`);
  }
  checkVersion(onDisk);
  return appConfigSchema.parse(deepMerge(defaultConfig(), onDisk));
}

/** Validate and write config.json atomically with owner-only permissions. */
export function writeConfig(cfg: AppConfig): void {
  ensureDataDirs();
  const validated = appConfigSchema.parse(cfg);
  // Nothing built from the old config outlives the save: `getModels` rebuilds whenever the
  // providers it is handed differ from the ones it last built.
  writeFileAtomicSync(configPath(), `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
}
