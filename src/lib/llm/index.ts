import { type Api, type Model, type Models, ModelsError } from "@earendil-works/pi-ai";
import { currentProviderId } from "@/lib/config/legacy-providers";
import type { AppConfig, LlmProviderConfig, ModelRef } from "@/lib/config/schema";
import type { LlmModelInfo, ProviderModels } from "@/lib/llm/types";
import { errorMessage } from "@/lib/utils";
import { missingSetup, modelMissingMessage, providerAuthKind, REAUTH_REQUIRED, reauthRequiredMessage } from "./catalog";
import { credentialStore } from "./credentials";
import { providerErrorText } from "./error-text";
import { getModels } from "./models";
import { providerDefinition } from "./providers";

/** The configured provider with this id, or with the id it was saved under before a pi rename. */
export function findProvider(config: AppConfig, id: string): LlmProviderConfig | undefined {
  const current = currentProviderId(id);
  return config.llm.providers.find((provider) => provider.id === current);
}

/** Everything a provider failure is shown as goes through here, so none of it arrives as a wire body. */
function providerError(err: unknown): string {
  return providerErrorText(errorMessage(err));
}

/** Whether `auth.json` holds a credential for a provider; an instance that signs in is usable only once it does. */
export async function isConnected(providerId: string): Promise<boolean> {
  return (await credentialStore().read(providerId)) !== undefined;
}

export interface ProviderAuthGap {
  code: "missing_key" | typeof REAUTH_REQUIRED;
  message: string;
}

/**
 * What the provider is still missing before it can serve a request, or undefined when it is ready:
 * an instance with a key in `config.json` needs nothing else, and one that signs in needs a
 * credential in `auth.json`. Nothing here talks to the provider.
 */
export async function providerAuthGap(provider: LlmProviderConfig): Promise<ProviderAuthGap | undefined> {
  if (providerAuthKind(provider) === "oauth") {
    if (await isConnected(provider.id)) return undefined;
    return { code: REAUTH_REQUIRED, message: reauthRequiredMessage(provider.name) };
  }
  const missing = missingSetup(provider);
  return missing ? { code: "missing_key", message: missing } : undefined;
}

class ProviderAuthError extends Error {
  constructor(readonly gap: ProviderAuthGap) {
    super(gap.message);
    this.name = "ProviderAuthError";
  }
}

/** A sign-in that is gone or could not be renewed; pi reports the second as a `ModelsError`. */
function needsReauth(err: unknown): boolean {
  if (err instanceof ProviderAuthError) return err.gap.code === REAUTH_REQUIRED;
  return err instanceof ModelsError && err.code === "oauth";
}

/** A provider's models; one that is not authenticated yet has none to offer, and no request to make. */
async function loadModels(provider: LlmProviderConfig, models: Models): Promise<LlmModelInfo[]> {
  const gap = await providerAuthGap(provider);
  if (gap) throw new ProviderAuthError(gap);
  return providerDefinition(provider).listModels(provider, models);
}

export type ModelResolutionFailure =
  | "not_configured"
  | "provider_missing"
  | "model_missing"
  | "models_unavailable"
  | typeof REAUTH_REQUIRED;

export type ModelResolution =
  | { ok: true; provider: LlmProviderConfig; info: LlmModelInfo; model: Model<Api> }
  | { ok: false; reason: ModelResolutionFailure; message: string };

/** The machine code a refused chat answers with; the browser turns two of them into a banner. */
export type ResolutionCode = "llm_not_configured" | "model_unavailable" | typeof REAUTH_REQUIRED;

/**
 * One mapping for every caller that refuses a chat over its model: nothing chosen asks for setup,
 * a lapsed sign-in asks for Reconnect, and everything else says the model cannot be used.
 */
export function resolutionCode(reason: ModelResolutionFailure): ResolutionCode {
  if (reason === REAUTH_REQUIRED) return REAUTH_REQUIRED;
  return reason === "not_configured" ? "llm_not_configured" : "model_unavailable";
}

/** What a request for a model is refused with when none was chosen. */
const NO_MODEL_MESSAGE = "No model selected. Add a provider and pick a default model in Settings › LLM.";

/** How to move off a model that is gone, by what holds the ref. */
const PICK_ANOTHER = {
  chat: "A chat keeps the model it started with; start a new chat to use another model.",
  task: "Edit the task to pick another model.",
  settings: "Pick another model in Settings › LLM.",
} as const;

/**
 * `ref` null → not_configured. Provider id unknown → provider_missing. Model not in the provider's
 * list → model_missing. Models could not be loaded (including a missing required key) →
 * models_unavailable. Messages are user-facing and name the provider/model.
 *
 * `heldBy` names what `ref` belongs to, so a model that is gone is answered with the fix that
 * reaches it: a started chat is fixed to its model and needs a new chat, a scheduled task needs
 * editing, and anything else (the default model) is picked in Settings.
 */
export async function resolveModel(
  config: AppConfig,
  ref: ModelRef | null,
  options?: { heldBy?: "chat" | "task" },
): Promise<ModelResolution> {
  if (!ref) {
    return { ok: false, reason: "not_configured", message: NO_MODEL_MESSAGE };
  }
  const pickAnother = PICK_ANOTHER[options?.heldBy ?? "settings"];
  const provider = findProvider(config, ref.provider);
  if (!provider) {
    return {
      ok: false,
      reason: "provider_missing",
      message: `The provider “${ref.provider}” behind ${ref.model} has been removed. ${pickAnother}`,
    };
  }

  let models: LlmModelInfo[];
  try {
    models = await loadModels(provider, getModels(config));
  } catch (err) {
    if (needsReauth(err)) {
      return { ok: false, reason: REAUTH_REQUIRED, message: reauthRequiredMessage(provider.name) };
    }
    return {
      ok: false,
      reason: "models_unavailable",
      message: `Could not load ${provider.name} models: ${providerError(err)}. Check the provider in Settings › LLM.`,
    };
  }
  const info = models.find((model) => model.id === ref.model);
  if (!info) {
    return {
      ok: false,
      reason: "model_missing",
      message: `${modelMissingMessage(provider.name, ref.model)} ${pickAnother}`,
    };
  }

  return { ok: true, provider, info, model: providerDefinition(provider).toPiModel(provider, info) };
}

/**
 * What a provider offers before it is authenticated. A sign-in provider's catalog is pi's own
 * static list, which costs no request and no credential, so a chat can still name the model it is
 * set to and say that the provider needs reconnecting — rather than reporting the model as gone.
 * A provider waiting on a key lists nothing, because its catalog is fetched with that key.
 */
function gatedModels(provider: LlmProviderConfig): LlmModelInfo[] {
  return providerDefinition(provider).catalogModels?.(provider) ?? [];
}

/**
 * Models of every saved provider, in config order; a failing provider gets `error` and `models: []`
 * instead of failing the call. A provider that is merely not authenticated keeps its catalog and is
 * marked with `authGap`, which is what the chat turns into a Reconnect banner.
 */
export async function listProviderModels(config: AppConfig): Promise<ProviderModels[]> {
  const runtime = getModels(config);
  return Promise.all(
    config.llm.providers.map(async (provider): Promise<ProviderModels> => {
      const entry = { provider: provider.id, name: provider.name, type: provider.type };
      try {
        const gap = await providerAuthGap(provider);
        if (gap) {
          const models = gap.code === REAUTH_REQUIRED ? gatedModels(provider) : [];
          return { ...entry, models, error: gap.message, authGap: gap.code };
        }
        return { ...entry, models: await providerDefinition(provider).listModels(provider, runtime) };
      } catch (err) {
        // A refresh that failed leaves a credential in place, so the gap above cannot see it.
        if (needsReauth(err)) {
          return { ...entry, models: gatedModels(provider), error: providerError(err), authGap: REAUTH_REQUIRED };
        }
        return { ...entry, models: [], error: providerError(err) };
      }
    }),
  );
}
