import { type Api, type ChatTemplateKwargValue, clampThinkingLevel, type Model } from "@earendil-works/pi-ai";

/**
 * What a hosted model's request at thinking Off carries, for a run record. The agent sends no level
 * for Off, and each of pi-ai's wire APIs fills that in its own way: an effort (`"none"`, or `"high"`
 * where Anthropic manages the effort), a switch that turns thinking off (`disabled`), the lowest
 * level a Gemini model accepts, or nothing at all (`not sent`).
 *
 * This follows pi-ai 0.99's request builders, deciding as they do by API and model fields and never
 * by a model's name; `thinking-off.test.ts` checks it against the request pi builds for every model
 * in its catalogs, so a pi upgrade that changes one fails there.
 */
export function hostedOff(model: Model<Api>): string {
  const off = model.thinkingLevelMap?.off;
  switch (model.api) {
    case "anthropic-messages":
      // A model whose effort pi manages always thinks adaptively, at "high" when no level is sent.
      if ((model as Model<"anthropic-messages">).compat?.supportsMidConvoEffort) return `"high"`;
      return off === null ? "not sent" : "disabled";
    case "openai-responses":
      // pi leaves Copilot's Responses models to the server's default.
      if (model.provider === "github-copilot") return "not sent";
      return off === null ? "not sent" : `"${off ?? "none"}"`;
    case "azure-openai-responses":
    case "openai-codex-responses":
      return off === null ? "not sent" : `"${off ?? "none"}"`;
    case "mistral-conversations":
      return off ? `"${off}"` : "not sent";
    case "google-generative-ai":
    case "google-vertex": {
      // A Gemini model that cannot turn thinking off is sent the lowest level it accepts. pi picks
      // level or budget control by model id, and in its catalogs every such model takes levels.
      const floor = clampThinkingLevel(model, "off");
      if (floor === "off") return "disabled";
      const value = model.thinkingLevelMap?.[floor];
      return value ? `${floor} → "${value}"` : floor;
    }
    case "openai-completions":
      return completionsOff(model as Model<"openai-completions">);
    default:
      return "not sent";
  }
}

/** Chat Completions encodes Off by the model's thinking format, which pi detects when none is set. */
function completionsOff(model: Model<"openai-completions">): string {
  const off = model.thinkingLevelMap?.off;
  const { format, reasoningEffort } = completionsThinking(model);
  switch (format) {
    case "zai":
    case "qwen":
    case "qwen-chat-template":
    case "together":
      return "disabled";
    case "deepseek":
      return off === null ? "not sent" : "disabled";
    case "openrouter":
    case "string-thinking":
      return off === null ? "not sent" : `"${off ?? "none"}"`;
    case "ant-ling":
      return "not sent";
    case "chat-template":
      return templateOff(model.compat?.chatTemplateKwargs, off);
    case "baseten":
      if (reasoningEffort && typeof off === "string") return `"${off}"`;
      return templateOff(model.compat?.chatTemplateArgs, off);
    default:
      return reasoningEffort && typeof off === "string" ? `"${off}"` : "not sent";
  }
}

/** A chat template's values at Off: an effort named for off, else a thinking switch, else nothing. */
function templateOff(values: Record<string, ChatTemplateKwargValue> | undefined, off: string | null | undefined): string {
  const sent = Object.values(values ?? {}).flatMap((value) =>
    typeof value === "object" && value !== null && !value.omitWhenOff ? [value.$var] : []);
  if (typeof off === "string" && sent.includes("thinking.effort")) return `"${off}"`;
  return sent.includes("thinking.enabled") ? "disabled" : "not sent";
}

/**
 * pi's thinking format and `reasoning_effort` support for a Chat Completions model: the model's own
 * compat fields, else what pi detects from its provider id and base URL.
 */
function completionsThinking(model: Model<"openai-completions">): { format: string; reasoningEffort: boolean } {
  const { provider, baseUrl } = model;
  const is = (ids: string[], hosts: string[]) => ids.includes(provider) || hosts.some((host) => baseUrl.includes(host));
  const deepseek = provider === "deepseek" || baseUrl.toLowerCase().includes("deepseek.com");
  const zai = is(["zai", "zai-coding-cn"], ["api.z.ai", "open.bigmodel.cn"]);
  const together = is(["together"], ["api.together.ai", "api.together.xyz"]);
  const antLing = is(["ant-ling"], ["api.ant-ling.com"]);
  const detected = deepseek ? "deepseek" : zai ? "zai" : together ? "together" : antLing ? "ant-ling"
    : is(["openrouter"], ["openrouter.ai"]) ? "openrouter" : "openai";
  const noEffort = zai || together || antLing || is(["xai"], ["api.x.ai"]) ||
    is(["moonshotai", "moonshotai-cn"], ["api.moonshot."]) ||
    is(["cloudflare-ai-gateway"], ["gateway.ai.cloudflare.com"]) || is(["nvidia"], ["integrate.api.nvidia.com"]);
  return {
    format: model.compat?.thinkingFormat ?? detected,
    reasoningEffort: model.compat?.supportsReasoningEffort ?? !noEffort,
  };
}
