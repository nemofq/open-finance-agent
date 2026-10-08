import type { LlmProviderType } from "@/lib/config/schema";
import type { PiBackedType } from "./providers/pi-backed";
import type { LlmModelInfo } from "./types";

/**
 * Models pi dropped from its catalog in favour of a true successor: the same family and tier under
 * a new id. The default model and standalone scheduled tasks saved on one are moved to its successor
 * at startup (`model-rewrite.ts`); a started chat never is.
 *
 * Every id an upgrade removes is decided here: a successor gets a row, and a model without one is
 * retired and gets none, so a ref to it stays `model_missing` and nothing stands in for it.
 * `scripts/pi-catalog-diff.mjs` lists the removed ids, and `model-aliases.test.ts` keeps each
 * `from` out of the installed catalog and each `to` in it.
 */
export interface ModelAlias {
  type: PiBackedType;
  from: string;
  /** How the catalog last described `from`; pi no longer knows it, and the notice in Settings › LLM shows it. */
  name: string;
  pricing: LlmModelInfo["pricing"];
  to: string;
}

export const modelAliases: readonly ModelAlias[] = [
  // pi-ai 0.85.1 → 0.99.1. Retired without a successor: openai-codex gpt-5.4 and gpt-5.4-mini.
  { type: "deepseek", from: "deepseek-v4-flash", name: "DeepSeek V4 Flash", pricing: { input: 0.14, output: 0.28 }, to: "deepseek-flash" },
  { type: "deepseek", from: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision Exp", pricing: { input: 0.14, output: 0.28 }, to: "deepseek-flash" },
  { type: "opencode", from: "mimo-v2.5-free", name: "MiMo V2.5 Free", pricing: { input: 0, output: 0 }, to: "mimo-v2.6-flash-free" },
  { type: "opencode", from: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Free", pricing: { input: 0, output: 0 }, to: "muse-spark-1.3-contributor-free" },
  // pi-ai 0.99.1 → 1.1.0. Cloudflare AI Gateway's Claude ids moved from dots to dashes. Retired
  // without a successor: together gemma-4-31B-it and gpt-oss-20b, opencode-go space-bunny-free
  // (the paid space-bunny is a different tier), and vercel-ai-gateway deepseek-v3.1-terminus,
  // ling-3.0-flash-sante-free, kimi-k2-thinking and step-3.5-flash.
  { type: "cloudflare-ai-gateway", from: "claude-fable-5.1", name: "Claude Fable 5.1", pricing: { input: 10, output: 50 }, to: "claude-fable-5-1" },
  { type: "cloudflare-ai-gateway", from: "claude-haiku-4.5", name: "Claude Haiku 4.5 (latest)", pricing: { input: 1, output: 5 }, to: "claude-haiku-4-5" },
  { type: "cloudflare-ai-gateway", from: "claude-opus-4.5", name: "Claude Opus 4.5 (latest)", pricing: { input: 5, output: 25 }, to: "claude-opus-4-5" },
  { type: "cloudflare-ai-gateway", from: "claude-opus-4.6", name: "Claude Opus 4.6", pricing: { input: 5, output: 25 }, to: "claude-opus-4-6" },
  { type: "cloudflare-ai-gateway", from: "claude-opus-4.7", name: "Claude Opus 4.7", pricing: { input: 5, output: 25 }, to: "claude-opus-4-7" },
  { type: "cloudflare-ai-gateway", from: "claude-opus-4.8", name: "Claude Opus 4.8", pricing: { input: 5, output: 25 }, to: "claude-opus-4-8" },
  { type: "cloudflare-ai-gateway", from: "claude-opus-5.5", name: "Claude Opus 5.5", pricing: { input: 4, output: 20 }, to: "claude-opus-5-5" },
  { type: "cloudflare-ai-gateway", from: "claude-sonnet-4.5", name: "Claude Sonnet 4.5 (latest)", pricing: { input: 3, output: 15 }, to: "claude-sonnet-4-5" },
  { type: "cloudflare-ai-gateway", from: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", pricing: { input: 3, output: 15 }, to: "claude-sonnet-4-6" },
  // Together renamed DeepSeek V4 Pro to its dated id.
  { type: "together", from: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro", pricing: { input: 1.74, output: 3.48 }, to: "deepseek-ai/DeepSeek-V4-Pro-0813" },
];

export function modelAlias(type: LlmProviderType, id: string): ModelAlias | undefined {
  return modelAliases.find((alias) => alias.type === type && alias.from === id);
}
