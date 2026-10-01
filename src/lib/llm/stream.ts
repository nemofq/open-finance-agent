import {
  type Api,
  type AssistantMessageEventStream,
  clampThinkingLevel,
  type Context,
  type Model,
  type Models,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { AppConfig, LlmProviderConfig } from "@/lib/config/schema";
import { CACHE_RETENTION } from "./ambient-env";
import { takesKey } from "./catalog";
import { draftModels, getModels } from "./models";
import { openCodeOptions } from "./opencode";
import { requestModel } from "./thinking";

/**
 * Every completion goes through pi-ai's `Models`, which owns auth, refresh and wire-API dispatch.
 * `streamSimple` is the seam the agent loop itself uses: provider-neutral options (`reasoning`,
 * `maxTokens`, `timeoutMs`) rather than one API's own option shape.
 */

/**
 * What a completion takes: pi's options, plus the chat a one-off request (a title, a compaction
 * summary) belongs to. That id reaches only OpenCode, as its session (see `openCodeOptions`).
 */
export interface StreamOptions extends SimpleStreamOptions {
  conversationId?: string;
}

/**
 * An instance whose way in takes a key sends it on every request, so a stale sign-in in `auth.json`
 * cannot stand in for it; one that signs in authenticates from `auth.json`, and one whose method
 * takes no key (Bedrock access keys or a profile, Vertex's gcloud sign-in) from pi's resolution of
 * its settings. A key left in the config from another method is never sent.
 */
function requestAuth(provider: LlmProviderConfig): Pick<SimpleStreamOptions, "apiKey"> {
  return takesKey(provider) && provider.apiKey ? { apiKey: provider.apiKey } : {};
}

/**
 * The level is clamped to one the model accepts with pi-ai's own `clampThinkingLevel` before it is
 * sent. Most of pi's wire APIs clamp too, but its Anthropic and Bedrock ones map an unaccepted level
 * straight to "high", so without this the wire would differ from what Settings and a run record say
 * (`runsAs`, `transmittedThinking`). An accepted level passes through unchanged.
 *
 * The prompt-cache retention is always named, so an exported `PI_CACHE_RETENTION` cannot change it.
 */
function stream(
  models: Models,
  provider: LlmProviderConfig,
  model: Model<Api>,
  context: Context,
  { conversationId, ...options }: StreamOptions = {},
): AssistantMessageEventStream {
  const clamped = options.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
  const reasoning = clamped === "off" ? undefined : clamped;
  const sent = withoutNativeToolChanges(requestModel(provider, model, reasoning));
  const cacheRetention = options.cacheRetention ?? CACHE_RETENTION;
  const routed = openCodeOptions(provider.type, options, conversationId);
  return models.streamSimple(sent, context, { ...routed, cacheRetention, reasoning, ...requestAuth(provider) });
}

/**
 * The harness never changes tools mid-conversation; left on, pi adds a hidden deferred placeholder
 * tool and a beta header on six first-party Claude models.
 */
function withoutNativeToolChanges(model: Model<Api>): Model<Api> {
  if (model.api !== "anthropic-messages") return model;
  const anthropic = model as Model<"anthropic-messages">;
  return { ...anthropic, compat: { ...anthropic.compat, supportsMidConvoToolChanges: false } };
}

/** Stream one completion from a saved provider; the model carries the id of the provider it was built for. */
export function streamModel(
  config: AppConfig,
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const provider = config.llm.providers.find((entry) => entry.id === model.provider);
  if (!provider) throw new Error(`The provider “${model.provider}” is no longer saved in Settings › LLM`);
  return stream(getModels(config), provider, model, context, options);
}

/** Stream from a provider as drafted on the settings page, before it is saved (validate, test). */
export function streamDraftModel(
  provider: LlmProviderConfig,
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  return stream(draftModels(provider), provider, model, context, options);
}
