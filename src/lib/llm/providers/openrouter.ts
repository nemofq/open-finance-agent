import { getSupportedThinkingLevels, type Model, type Models, type Provider } from "@earendil-works/pi-ai";
import { cached } from "@/lib/cache";
import { type OpenRouterProviderConfig, thinkingLevels } from "@/lib/config/schema";
import type { LlmModelInfo, LlmProviderDefinition, ProviderValidation } from "@/lib/llm/types";
import { errorMessage } from "@/lib/utils";
import { configKeyAuth } from "./auth";
import { completionsModel, completionsProvider } from "./completions";

const BASE_URL = "https://openrouter.ai/api/v1";
const MODELS_TTL_SECONDS = 6 * 60 * 60;

/** Attribution headers OpenRouter uses for app rankings. */
const appHeaders = {
  "HTTP-Referer": "https://github.com/nemofq/open-finance-agent",
  "X-Title": "Open Finance Agent",
};

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number | null;
  pricing: { prompt: string; completion: string };
  supported_parameters?: string[];
  /** Whether thinking can be turned off (`mandatory`) and the efforts the model takes. */
  reasoning?: { mandatory?: boolean; supported_efforts?: string[] };
  /** `input_modalities` is how OpenRouter reports vision; a model without it is read as text-only. */
  architecture?: { input_modalities?: string[] };
}

interface OpenRouterKey {
  label: string;
  usage: number;
  limit: number | null;
}

/** A stalled catalog must fail its own provider, not hold up every model list waiting on it. */
const REQUEST_TIMEOUT_MS = 15_000;

async function get<T>(path: string, apiKey?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { ...appHeaders, ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`OpenRouter ${path} did not respond within ${REQUEST_TIMEOUT_MS / 1000} s`);
    }
    throw err;
  }
  if (!res.ok) throw new Error(`OpenRouter ${path} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

const perMillion = (perToken: string) => Math.round(Number(perToken) * 1e6 * 1000) / 1000;

function toInfo(m: OpenRouterModel): LlmModelInfo {
  const params = m.supported_parameters ?? [];
  return {
    id: m.id,
    name: m.name,
    contextLength: m.context_length ?? 0,
    pricing: { input: perMillion(m.pricing.prompt), output: perMillion(m.pricing.completion) },
    supportsReasoning: params.includes("reasoning"),
    ...(m.reasoning ? { reasoningControl: reasoningControl(m.reasoning) } : {}),
    supportsImages: m.architecture?.input_modalities?.includes("image") ?? false,
  };
}

function reasoningControl(reasoning: NonNullable<OpenRouterModel["reasoning"]>): LlmModelInfo["reasoningControl"] {
  const efforts = reasoning.supported_efforts;
  return { mandatory: reasoning.mandatory === true, ...(efforts?.length ? { efforts } : {}) };
}

async function fetchCatalog(): Promise<LlmModelInfo[]> {
  const { data } = await get<{ data: OpenRouterModel[] }>("/models?supported_parameters=tools");
  return data.map(toInfo).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Lists cached tool-capable models from OpenRouter; pass `refresh` to bypass cache. The levels each
 * accepts are read off the pi model it streams as, so they follow `toPiModel` rather than the cache.
 */
async function listModels(
  config: OpenRouterProviderConfig,
  _models: Models,
  options?: { refresh?: boolean },
): Promise<LlmModelInfo[]> {
  const models = await cached("llm-models:openrouter:v3", MODELS_TTL_SECONDS, fetchCatalog, { refresh: options?.refresh });
  return models.map((info) => ({ ...info, thinkingLevels: getSupportedThinkingLevels(toPiModel(config, info)) }));
}

function credits({ label, usage, limit }: OpenRouterKey): string {
  const used = `$${usage.toFixed(2)} used`;
  return `Key “${label}” · ${limit == null ? `${used}, no limit` : `${used} of $${limit.toFixed(2)}`}`;
}

async function validate(config: OpenRouterProviderConfig, models: Models): Promise<ProviderValidation> {
  if (!config.apiKey) return { ok: false, error: "Enter an API key first" };
  try {
    const { data } = await get<{ data: OpenRouterKey }>("/key", config.apiKey);
    return { ok: true, message: credits(data), models: await listModels(config, models, { refresh: true }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * The levels a reasoning model is sent, from what the catalog says it controls. Off goes out as effort
 * `"none"` unless thinking is mandatory; with no `reasoning` block nothing says Off is honoured, so it
 * is not sent and the model keeps its default. Listed efforts limit the levels above Off to those.
 */
function thinkingLevelMap(info: LlmModelInfo): Model<"openai-completions">["thinkingLevelMap"] {
  if (!info.supportsReasoning) return undefined;
  const control = info.reasoningControl;
  if (!control) return { off: null };
  const map: NonNullable<Model<"openai-completions">["thinkingLevelMap"]> = { off: control.mandatory ? null : "none" };
  const { efforts } = control;
  if (efforts) for (const level of thinkingLevels.slice(1)) map[level] = efforts.includes(level) ? level : null;
  return map;
}

function toPiModel(config: OpenRouterProviderConfig, info: LlmModelInfo): Model<"openai-completions"> {
  return completionsModel(config, info, BASE_URL, {
    thinkingLevelMap: thinkingLevelMap(info),
    headers: appHeaders,
    compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter" },
  });
}

/**
 * The catalog is a network call, so the pi provider carries no static model list: every model the
 * app streams is built by `toPiModel` from the entry the user picked.
 */
function toPiProvider(config: OpenRouterProviderConfig): Provider {
  return completionsProvider(config, BASE_URL, configKeyAuth("OpenRouter API key", config.apiKey));
}

export const openrouter: LlmProviderDefinition<OpenRouterProviderConfig> = {
  toPiProvider,
  validate,
  listModels,
  toPiModel,
};
