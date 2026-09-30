import type { LlmProviderConfig } from "@/lib/config/schema";
import { restoreSecrets } from "@/lib/config/secrets";
import { llmInstanceSecretPaths } from "@/lib/llm/provider-types";

/**
 * The settings page sends providers with their saved key, and any other saved secret, masked.
 * Swap each mask back for the value of the saved provider with the same id AND type (or "" when
 * there is none): a draft may point at any URL, so a key must never follow a different provider.
 * Editing an endpoint's URL keeps its key, which is the normal edit flow.
 */
export function restoreDraftKey(draft: LlmProviderConfig, saved: LlmProviderConfig[]): LlmProviderConfig {
  const match = saved.find((provider) => provider.id === draft.id && provider.type === draft.type);
  return restoreSecrets(draft, match ?? {}, llmInstanceSecretPaths);
}
