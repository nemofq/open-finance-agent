/**
 * Pure helpers for the LLM settings page, where each provider card edits an unsaved draft: the
 * models each draft or saved provider offers, the draft as the server accepts it, and endpoint URL checks.
 */
import { openAICompatibleProviderSchema, type CustomModelConfig, type LlmProviderConfig } from "@/lib/config/schema";
import { activeSettings, customModelInfo, llmProviderCatalog, setupMethod } from "@/lib/llm/catalog";
import type { LlmModelInfo, LlmModelsResponse, ProviderModels, ProviderValidation } from "@/lib/llm/types";
import { deepEqual } from "@/lib/utils";

/** Trim and drop trailing slashes, the form the server stores and calls. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Whether the config schema accepts `url` as an endpoint base URL. */
export function isHttpUrl(url: string): boolean {
  return openAICompatibleProviderSchema.shape.baseUrl.safeParse(normalizeBaseUrl(url)).success;
}

/**
 * A draft provider as the config schema accepts it, which is what Save, Validate and Test send. While
 * the user types, the page allows a cleared name and blank or repeated model rows; the name falls
 * back to the type's, ids are trimmed as the server stores them, and blank or repeated rows are
 * left out (the first of a repeated id wins).
 */
export function requestProvider(provider: LlmProviderConfig): LlmProviderConfig {
  const name = provider.name.trim() || llmProviderCatalog[provider.type].name;
  if (provider.type !== "openai-compatible") return { ...provider, name };
  const seen = new Set<string>();
  const models = provider.models.flatMap((model) => {
    const id = model.id.trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ ...model, id }];
  });
  return { ...provider, name, baseUrl: normalizeBaseUrl(provider.baseUrl), models };
}

/**
 * Whether a Validate result for `validated` still describes `current`: the same key and, for an
 * endpoint, the same URL; for a type with setup fields, the same method and the same values.
 */
export function validationApplies(validated: LlmProviderConfig, current: LlmProviderConfig): boolean {
  if (validated.type !== current.type || validated.apiKey !== current.apiKey) return false;
  if (validated.type === "openai-compatible" && current.type === "openai-compatible") {
    return normalizeBaseUrl(validated.baseUrl) === normalizeBaseUrl(current.baseUrl);
  }
  return (
    setupMethod(validated)?.id === setupMethod(current)?.id &&
    deepEqual(activeSettings(validated), activeSettings(current))
  );
}

/** A Validate result together with the draft it was run on. */
export interface ProviderCheck {
  provider: LlmProviderConfig;
  validation: ProviderValidation;
}

/** Each draft provider's last Validate result, left out once its key or URL has changed since. */
export function currentValidations(
  providers: LlmProviderConfig[],
  checks: Record<string, ProviderCheck>,
): Record<string, ProviderValidation> {
  return Object.fromEntries(
    providers.flatMap((provider) => {
      const check = checks[provider.id];
      return check && validationApplies(check.provider, provider) ? [[provider.id, check.validation]] : [];
    }),
  );
}

/** Where the saved providers' model lists stand (`useLlmModels`). */
export interface SavedModelsStatus {
  loading: boolean;
  error: string | null;
}

const VALIDATE_TO_LOAD = "Validate the API key to load models";

/** A provider missing from the saved models list: still loading, failed to load, or `otherwise`. */
function unlistedModels(
  base: Pick<ProviderModels, "provider" | "name" | "type">,
  status: SavedModelsStatus,
  otherwise: string,
): ProviderModels {
  if (status.loading) return { ...base, models: [], error: "Loading models…" };
  return { ...base, models: [], error: status.error ? `Models failed to load: ${status.error}` : otherwise };
}

/**
 * What each card's Test picker offers for its draft provider. OpenRouter uses its last validation,
 * else the saved provider's list from `/api/settings/llm/models`; endpoints use their draft model
 * rows, so unsaved edits can be tested before saving. The saved list's error describes the saved
 * key, so once a different key is typed into the draft (`savedProviders` holds the saved configs)
 * the picker asks for that key to be validated instead.
 */
export function draftProviderModels(
  providers: LlmProviderConfig[],
  saved: LlmModelsResponse | null,
  validations: Record<string, ProviderValidation>,
  status: SavedModelsStatus = { loading: false, error: null },
  savedProviders: LlmProviderConfig[] = [],
): ProviderModels[] {
  return providers.map((draft) => {
    const provider = requestProvider(draft);
    const base = { provider: provider.id, name: provider.name, type: provider.type };
    if (provider.type === "openai-compatible") {
      const models = provider.models.map(customModelInfo);
      return models.length > 0 ? { ...base, models } : { ...base, models, error: "Add a model id to use this endpoint" };
    }
    const validated = validations[provider.id]?.models;
    if (validated) return { ...base, models: validated };
    const stored = saved?.providers.find((entry) => entry.provider === provider.id);
    if (stored) {
      const savedKey = savedProviders.find((entry) => entry.id === provider.id)?.apiKey;
      const error = stored.error && savedKey !== undefined && savedKey !== provider.apiKey ? VALIDATE_TO_LOAD : stored.error;
      return { ...base, models: stored.models, ...(error ? { error } : {}) };
    }
    return unlistedModels(base, status, VALIDATE_TO_LOAD);
  });
}

/**
 * What the default-model picker offers: each saved provider's entry from `/api/settings/llm/models`,
 * so unsaved card edits stay out of it. A provider saved since that list loaded shows as loading.
 */
export function savedProviderModels(
  providers: LlmProviderConfig[],
  saved: LlmModelsResponse | null,
  status: SavedModelsStatus,
): ProviderModels[] {
  return providers.map(
    ({ id, name, type }) =>
      saved?.providers.find((entry) => entry.provider === id) ??
      unlistedModels({ provider: id, name, type }, status, "Models not loaded"),
  );
}

/** Configured ids the endpoint does not list, and listed models not configured yet. */
export function compareListed(
  configured: CustomModelConfig[],
  listed: LlmModelInfo[],
): { missing: string[]; toAdd: LlmModelInfo[] } {
  const configuredIds = new Set(configured.map((model) => model.id.trim()).filter(Boolean));
  const listedIds = new Set(listed.map((model) => model.id));
  return {
    missing: [...configuredIds].filter((id) => !listedIds.has(id)),
    toAdd: listed.filter((model) => !configuredIds.has(model.id)),
  };
}

/** A listed model as a new row, keeping its context window when the endpoint reported one. */
export function customModelFromListing(info: LlmModelInfo): CustomModelConfig {
  return info.contextLength ? { id: info.id, contextWindow: info.contextLength } : { id: info.id };
}
