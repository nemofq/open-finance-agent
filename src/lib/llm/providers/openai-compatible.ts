import { getSupportedThinkingLevels, type Model, type Provider } from "@earendil-works/pi-ai";
import type { OpenAICompatibleProviderConfig } from "@/lib/config/schema";
import { customModelInfo, neutralModelInfo } from "@/lib/llm/catalog";
import { customModelEntry, customThinkingLevelMap } from "@/lib/llm/thinking";
import type { LlmModelInfo, LlmProviderDefinition, ProviderValidation } from "@/lib/llm/types";
import { errorMessage, isRecord } from "@/lib/utils";
import { configKeyAuth } from "./auth";
import { completionsModel, completionsProvider } from "./completions";

const VALIDATE_TIMEOUT_MS = 15_000;

/** A server that needs no key still gets one: the OpenAI client insists on a bearer token. */
const NO_KEY_NEEDED = "not-needed";

/** `https://host/v1/ ` → `https://host/v1`, so paths can be appended with a single slash. */
function baseUrl(config: OpenAICompatibleProviderConfig): string {
  return config.baseUrl.trim().replace(/\/+$/, "");
}

/** Servers name the context window differently: OpenRouter-style, vLLM, and a few gateways. */
function contextLength(entry: Record<string, unknown>): number {
  const lengths = [entry.context_length, entry.max_model_len, entry.context_window];
  return lengths.find((value): value is number => typeof value === "number") ?? 0;
}

/** The entries of a model list: OpenAI's `{ data: [...] }`, or the bare array some hosts (Together) return. */
function listEntries(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  return isRecord(body) && Array.isArray(body.data) ? body.data : null;
}

function hasId(entry: unknown): entry is Record<string, unknown> & { id: string } {
  return isRecord(entry) && typeof entry.id === "string";
}

/** Why a request never got a response: the underlying cause (ECONNREFUSED, DNS) beats "fetch failed". */
function networkError(url: string, err: unknown): string {
  if (err instanceof Error && err.name === "TimeoutError") {
    return `No response from ${url} within ${VALIDATE_TIMEOUT_MS / 1000} s`;
  }
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  return `Could not reach ${url}: ${errorMessage(cause)}`;
}

/** List the endpoint's models: proves the URL and the key without spending tokens. */
async function validate(config: OpenAICompatibleProviderConfig): Promise<ProviderValidation> {
  const url = `${baseUrl(config)}/models`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: networkError(url, err) };
  }

  if (res.status === 401 || res.status === 403) {
    const error = config.apiKey
      ? `The endpoint rejected the key (${res.status})`
      : `The endpoint requires an API key (${res.status})`;
    return { ok: false, error };
  }
  if (res.status === 404) {
    return {
      ok: false,
      error: `No model list at ${url} (404). Check the base URL (it usually ends in /v1); if the endpoint does not list models, add model ids by hand and use Test.`,
    };
  }
  if (!res.ok) return { ok: false, error: `${url} responded ${res.status} ${res.statusText}`.trim() };

  const entries = listEntries(await res.json().catch(() => null));
  if (!entries) {
    return { ok: false, error: `${url} did not return an OpenAI model list ({ "data": [{ "id": … }] })` };
  }
  // An entry without an id cannot be picked; skip it rather than reject the whole list. `/models`
  // says nothing about vision, so images stay off until the user ticks the box.
  const models = entries.filter(hasId).map((entry) => neutralModelInfo(entry.id, contextLength(entry)));
  return { ok: true, message: `Reachable · ${models.length} models listed`, models };
}

/**
 * The models the user listed by hand; the endpoint is not consulted. The levels each accepts come
 * from the pi model its declared `thinking` block builds, so xhigh and max appear once named.
 */
async function listModels(config: OpenAICompatibleProviderConfig): Promise<LlmModelInfo[]> {
  return config.models.map((model) => {
    const info = customModelInfo(model);
    return { ...info, thinkingLevels: getSupportedThinkingLevels(toPiModel(config, info)) };
  });
}

function toPiModel(config: OpenAICompatibleProviderConfig, info: LlmModelInfo): Model<"openai-completions"> {
  // The level names this server expects, as declared on the model; how Off is sent is decided per
  // request in `stream.ts`, because one of the off mechanisms needs a different request format.
  const thinkingLevelMap = info.supportsReasoning
    ? customThinkingLevelMap(customModelEntry(config, info.id)?.thinking)
    : undefined;
  return completionsModel(config, info, baseUrl(config), thinkingLevelMap ? { thinkingLevelMap } : {});
}

/** The hand-listed models are the endpoint's whole catalog, so the pi provider can carry them. */
function toPiProvider(config: OpenAICompatibleProviderConfig): Provider {
  return completionsProvider(config, baseUrl(config), configKeyAuth(`${config.name} key`, config.apiKey || NO_KEY_NEEDED),
    config.models.map((model) => toPiModel(config, customModelInfo(model))));
}

export const openAICompatible: LlmProviderDefinition<OpenAICompatibleProviderConfig> = {
  toPiProvider,
  validate,
  listModels,
  toPiModel,
};
