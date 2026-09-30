import { type Api, clampThinkingLevel, type Model, type SimpleStreamOptions, type ThinkingLevelMap } from "@earendil-works/pi-ai";
import type { CustomModelConfig, CustomThinkingConfig, LlmProviderConfig, ThinkingLevel } from "@/lib/config/schema";
import { hostedOff } from "./thinking-off";

/**
 * Thinking on a hand-listed endpoint model. Chat Completions does not standardise how thinking is
 * levelled or switched off, so the model's `thinking` block in `config.json` declares both and this
 * module turns the declaration into pi-ai's public per-model fields. Nothing here looks at a model's
 * name, and hosted providers are left to pi-ai's own catalog.
 */

/** The levels an endpoint model may name a server value for: every pi level above off. */
const onLevels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** The endpoint model's entry in `config.json`, or undefined for a hosted provider or an unlisted id. */
export function customModelEntry(provider: LlmProviderConfig, modelId: string): CustomModelConfig | undefined {
  return provider.type === "openai-compatible" ? provider.models.find((model) => model.id === modelId) : undefined;
}

/**
 * pi-ai's `thinkingLevelMap` for a declared `thinking` block: the server's name for each level that
 * has one, and `off: "none"` when thinking is turned off by `reasoning_effort: "none"`. The other off
 * mechanisms send no `reasoning_effort` at all, so they leave `off` unmapped.
 */
export function customThinkingLevelMap(thinking: CustomThinkingConfig | undefined): ThinkingLevelMap | undefined {
  const map: ThinkingLevelMap = {};
  for (const level of onLevels) {
    const name = thinking?.levels?.[level];
    if (name) map[level] = name;
  }
  if (thinking?.off === "none") map.off = "none";
  return Object.keys(map).length > 0 ? map : undefined;
}

/**
 * The model one request goes out with. An endpoint model declared with `off: "chat-template"` is
 * switched off with `chat_template_kwargs: { enable_thinking: false }`, but pi-ai has no request
 * format that also sends `reasoning_effort` for the levels, so only an Off request gets a variant in
 * the chat-template format; every other request keeps the default OpenAI format.
 */
export function requestModel(
  provider: LlmProviderConfig,
  model: Model<Api>,
  reasoning: SimpleStreamOptions["reasoning"] | "off",
): Model<Api> {
  if (model.api !== "openai-completions" || !model.reasoning) return model;
  if (reasoning && reasoning !== "off") return model;
  if (customModelEntry(provider, model.id)?.thinking?.off !== "chat-template") return model;
  const completions = model as Model<"openai-completions">;
  return {
    ...completions,
    compat: { ...completions.compat, thinkingFormat: "chat-template", chatTemplateKwargs: { enable_thinking: false } },
  };
}

/**
 * What a request at `level` sends for this model, for a run record. Above off, the level is clamped
 * to one the model accepts (`medium → high`), and that level is what pi-ai receives. The value it
 * becomes is shown only where it is ours to know: an endpoint's declared name or the level itself
 * (`high → "xhigh"`), or a hosted model's catalog value (`max → "max"`). Otherwise each wire API
 * encodes the level its own way (a name, an effort, a token budget), so the record stops at the
 * level. Off sends no level, which each wire API fills in its own way: a hosted model's record says
 * what goes out (`off → "none"`, `off → disabled`, `off → not sent`), an endpoint's the mechanism
 * its model declares (`off → chat-template`).
 */
export function transmittedThinking(provider: LlmProviderConfig, model: Model<Api>, level: ThinkingLevel): string {
  const endpoint = provider.type === "openai-compatible";
  if (!model.reasoning) return `${level} → not sent (model not marked for reasoning)`;
  if (level === "off") return `off → ${offSent(provider, model)}`;
  const clamped = clampThinkingLevel(model, level);
  const runs = clamped === level ? level : `${level} → ${clamped}`;
  // A level clamped to off goes out as Off does: with no level.
  if (clamped === "off") return `${runs} → ${offSent(provider, model)}`;
  const value = model.thinkingLevelMap?.[clamped] ?? (endpoint ? clamped : undefined);
  return value ? `${runs} → "${value}"` : runs;
}

/** What a request with no level carries for this model. */
function offSent(provider: LlmProviderConfig, model: Model<Api>): string {
  if (provider.type !== "openai-compatible") return hostedOff(model);
  const off = customModelEntry(provider, model.id)?.thinking?.off ?? "omit";
  return off === "none" ? `"none"` : off;
}
