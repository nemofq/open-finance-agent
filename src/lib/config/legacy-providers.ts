import { isRecord } from "@/lib/utils";

/**
 * Hosted provider ids pi renamed, old to new. A hosted provider's id and type are its pi provider
 * id, so a rename reaches every saved reference: the provider in `config.json`, the default model,
 * and the model refs of saved chats and scheduled tasks. The config is renamed as it is read and
 * saved under the new id on its next write; the other refs resolve through `currentProviderId`.
 */
const renamedProviderIds: Readonly<Record<string, string>> = {
  // pi-ai 1.0.3 renamed its Azure OpenAI provider.
  "azure-openai-responses": "azure",
};

/** The id a provider id saved by an earlier release is known by now. */
export function currentProviderId(id: string): string {
  return Object.hasOwn(renamedProviderIds, id) ? renamedProviderIds[id] : id;
}

/**
 * `config.json` as read, with renamed provider ids replaced in the provider list and the default
 * model. Anything not shaped like a config is returned as it is, for the schema to report.
 */
export function renameLegacyProviders(onDisk: unknown): unknown {
  if (!isRecord(onDisk) || !isRecord(onDisk.llm)) return onDisk;
  const llm = onDisk.llm;
  const providers = Array.isArray(llm.providers)
    ? llm.providers.map((provider) =>
        isRecord(provider) && typeof provider.type === "string" && currentProviderId(provider.type) !== provider.type
          ? {
              ...provider,
              type: currentProviderId(provider.type),
              id: typeof provider.id === "string" ? currentProviderId(provider.id) : provider.id,
            }
          : provider,
      )
    : llm.providers;
  const defaultModel =
    isRecord(llm.defaultModel) && typeof llm.defaultModel.provider === "string"
      ? { ...llm.defaultModel, provider: currentProviderId(llm.defaultModel.provider) }
      : llm.defaultModel;
  return { ...onDisk, llm: { ...llm, providers, defaultModel } };
}

/** A saved model ref with its provider id brought up to date; the same object when nothing changed. */
export function currentModelRef<T extends { provider: string }>(ref: T): T {
  const provider = currentProviderId(ref.provider);
  return provider === ref.provider ? ref : { ...ref, provider };
}
