import { type ApiKeyAuth, createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { LlmProviderConfig } from "@/lib/config/schema";
import type { LlmModelInfo } from "@/lib/llm/types";

/**
 * The pi side of a provider type pi-ai does not implement but that speaks OpenAI chat completions,
 * so such a type only has to write its own `validate` and `listModels`.
 */

/** The pi provider registered under `config.id`, authenticated by `configKeyAuth`. */
export function completionsProvider(
  config: LlmProviderConfig,
  baseUrl: string,
  apiKey: ApiKeyAuth,
  models: Model<"openai-completions">[] = [],
): Provider {
  return createProvider({
    id: config.id,
    name: config.name,
    baseUrl,
    auth: { apiKey },
    models,
    // Keyed rather than a single implementation, so a model naming another API fails loudly.
    api: { "openai-completions": openAICompletionsApi() },
  });
}

/** A pi-ai model built from the entry the user picked; `extras` adds what only the type knows. */
export function completionsModel(
  config: LlmProviderConfig,
  info: LlmModelInfo,
  baseUrl: string,
  extras: Partial<Model<"openai-completions">> = {},
): Model<"openai-completions"> {
  return {
    id: info.id,
    name: info.name,
    api: "openai-completions",
    provider: config.id,
    baseUrl,
    reasoning: info.supportsReasoning,
    input: info.supportsImages ? ["text", "image"] : ["text"],
    cost: { input: info.pricing.input, output: info.pricing.output, cacheRead: 0, cacheWrite: 0 },
    contextWindow: info.contextLength,
    maxTokens: info.maxTokens ?? 16384,
    ...extras,
  };
}
