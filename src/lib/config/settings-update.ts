import { deepMerge } from "@/lib/utils";
import { type AppConfig, appConfigSchema } from "./schema";
import { restoreSecrets } from "./secrets";

/** A default model whose provider is gone is cleared, so deleting a provider leaves no dangling default. */
function dropOrphanedDefault(cfg: AppConfig): AppConfig {
  const { defaultModel, providers } = cfg.llm;
  if (!defaultModel || providers.some((provider) => provider.id === defaultModel.provider)) return cfg;
  return { ...cfg, llm: { ...cfg.llm, defaultModel: null } };
}

/**
 * Turn a full or partial config sent by the browser into the config to persist: masked secrets
 * fall back to the values already on disk, the rest is deep-merged onto the existing config, and
 * the result is validated. `secrets` must name every secret the browser was sent masked, modules'
 * own included (`settingsSecretPaths` in `src/app/api/settings/secrets.ts`).
 */
export function applySettingsUpdate(existing: AppConfig, incoming: Record<string, unknown>, secrets: readonly string[]): AppConfig {
  const restored = restoreSecrets(incoming, existing, secrets);
  return dropOrphanedDefault(appConfigSchema.parse(deepMerge(existing, restored)));
}
