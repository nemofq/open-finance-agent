import type { LlmProviderConfig, LlmProviderType } from "@/lib/config/schema";
import type { LlmProviderDefinition } from "@/lib/llm/types";
import { openAICompatible } from "./openai-compatible";
import { openrouter } from "./openrouter";
import { piBackedDefinitions } from "./pi-backed";

/**
 * Server implementation of every provider type. A type pi-ai already implements is a row in
 * `pi-backed.ts`; anything else is a `providers/<type>.ts` of its own, listed here.
 */
const llmProviderDefinitions: {
  [T in LlmProviderType]: LlmProviderDefinition<Extract<LlmProviderConfig, { type: T }>>;
} = {
  ...piBackedDefinitions,
  openrouter,
  "openai-compatible": openAICompatible,
};

export function providerDefinition<C extends LlmProviderConfig>(provider: C): LlmProviderDefinition<C> {
  return llmProviderDefinitions[provider.type] as unknown as LlmProviderDefinition<C>;
}
