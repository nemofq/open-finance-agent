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
];

export function modelAlias(type: LlmProviderType, id: string): ModelAlias | undefined {
  return modelAliases.find((alias) => alias.type === type && alias.from === id);
}
