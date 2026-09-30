import { createHash } from "node:crypto";
import { type AuthContext, createModels, type Models, type MutableModels } from "@earendil-works/pi-ai";
import type { AppConfig, LlmProviderConfig } from "@/lib/config/schema";
import { processSingleton } from "@/lib/process-state";
import { clearProviderEnv } from "./ambient-env";
import { credentialStore } from "./credentials";
import { providerDefinition } from "./providers";

/**
 * `config.json` says which provider instances exist; this turns that into the one pi-ai `Models`
 * collection every model call goes through.
 */

/**
 * pi resolves nothing from the environment: keys come from `config.json` and tokens
 * from `auth.json`, so no `ANTHROPIC_API_KEY` or `~/.aws/credentials` left over on the machine can
 * stand in for a provider the user has not connected.
 */
const sealedAuthContext: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

function build(providers: LlmProviderConfig[]): MutableModels {
  const models = createModels({ credentials: credentialStore(), authContext: sealedAuthContext });
  for (const provider of providers) {
    models.setProvider(providerDefinition(provider).toPiProvider(provider));
  }
  return models;
}

interface ModelsCache {
  key: string;
  models: MutableModels;
}

/** The current collection, one per process; `current` is replaced whenever the providers change. */
const modelsCache = () => processSingleton<{ current?: ModelsCache }>("llm.models", () => ({}));

function cacheKey(providers: LlmProviderConfig[]): string {
  return createHash("sha256").update(JSON.stringify(providers)).digest("hex");
}

/**
 * The collection of every saved provider, rebuilt whenever `config.llm.providers` changes and kept
 * once per process so a dev hot reload does not hand out a second one. The credential store is
 * shared across rebuilds, because its locks are what keeps a rotating token from being burnt twice.
 */
export function getModels(config: AppConfig): Models {
  // Every request and sign-in starts from a collection, so a variable `next dev` restored is cleared again.
  clearProviderEnv();
  const key = cacheKey(config.llm.providers);
  const cache = modelsCache();
  if (cache.current?.key !== key) cache.current = { key, models: build(config.llm.providers) };
  return cache.current.models;
}

/** A throwaway collection for one provider drafted in Settings, which `config.json` does not hold yet. */
export function draftModels(provider: LlmProviderConfig): Models {
  clearProviderEnv();
  return build([provider]);
}
