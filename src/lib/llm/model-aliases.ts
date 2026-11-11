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
  // pi-ai 1.1.0 → 1.2.0: nothing renamed. Retired without a successor: google-vertex
  // gemini-flash-latest and gemini-flash-lite-latest (moving aliases, not one model), opencode
  // fledge-alpha-free, and vercel-ai-gateway alibaba/qwen-3.6-max-preview,
  // qwen3-235b-a22b-thinking, qwen3-coder-plus, qwen3-max, qwen3-max-preview,
  // qwen3-vl-235b-a22b-instruct, qwen3-vl-thinking, anthropic/claude-3-haiku and claude-opus-4.
  // pi-ai 1.2.0 → 1.3.0. Retired without a successor: nvidia moonshotai/kimi-k3, opencode
  // exo-free, ling-3.0-flash-fin-free and ling-3.1-flash-free, and vercel-ai-gateway
  // inclusionai/ling-3.1-flash-free (the paid Ling 3.1 Flash is a different tier).
  { type: "nvidia", from: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super", pricing: { input: 0.2, output: 0.8 }, to: "nvidia/nemotron-3.5-super-vl-120b-a12b" },
  { type: "opencode-go", from: "deepseek-v4-flash", name: "DeepSeek V4 Flash", pricing: { input: 0.15, output: 0.6 }, to: "deepseek-v4.1-flash" },
  { type: "opencode-go", from: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision Exp", pricing: { input: 0.15, output: 0.6 }, to: "deepseek-v4.1-flash" },
  { type: "opencode-go", from: "minimax-m2.7", name: "MiniMax-M2.7", pricing: { input: 0.3, output: 1.2 }, to: "minimax-m3" },
  { type: "opencode-go", from: "grok-4.6", name: "Grok 4.6", pricing: { input: 2, output: 6 }, to: "grok-4.7" },
  // pi-ai 1.3.0 → 1.4.0. Retired without a successor: azure and openai gpt-5.2-chat-latest and
  // gpt-5.3-chat-latest (moving aliases); baseten Kimi K2.5, K2.6 and K2.7 Code (Kimi K3 is a
  // different tier), Nemotron Super, inkling, inkling-small and GLM-4.7; github-copilot
  // kimi-k2.7-code, gpt-5-mini, gpt-5.4, gpt-5.4-mini and gpt-5.5; mistral open-mistral-7b,
  // open-mixtral-8x7b and open-mixtral-8x22b; openai-codex gpt-5.5 and gpt-5.3-codex-spark, which
  // the Codex backend rejects for ChatGPT accounts; opencode claude-sonnet-4, cat-jam-free,
  // space-bunny-free, step-5-preview-free and muse-spark-1.3-contributor-free, so the
  // muse-spark-1.2 row above it went too; opencode-go cat-jam-free, space-bunny and
  // step-5-preview-free (the paid step-5-preview is a different tier); together Llama 3.3 70B,
  // nemotron-3-ultra-550b-a55b and Qwen 2.5 7B; and vercel-ai-gateway anthropic/claude-sonnet-4
  // and stealth/cat-jam.
  { type: "baseten", from: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro", pricing: { input: 1.74, output: 3.48 }, to: "deepseek-ai/DeepSeek-V4-Pro-0813" },
  { type: "baseten", from: "zai-org/GLM-5", name: "GLM 5", pricing: { input: 0.95, output: 3.15 }, to: "zai-org/GLM-5.3" },
  { type: "baseten", from: "zai-org/GLM-5.1", name: "GLM 5.1", pricing: { input: 1.3, output: 4.3 }, to: "zai-org/GLM-5.3" },
  { type: "github-copilot", from: "claude-opus-4.7", name: "Claude Opus 4.7", pricing: { input: 5, output: 25 }, to: "claude-opus-4.8" },
  { type: "github-copilot", from: "gemini-3.5-flash", name: "Gemini 3.5 Flash", pricing: { input: 1.5, output: 9 }, to: "gemini-3.8-flash" },
  { type: "github-copilot", from: "gemini-3.6-flash", name: "Gemini 3.6 Flash", pricing: { input: 0.75, output: 3.75 }, to: "gemini-3.8-flash" },
  { type: "github-copilot", from: "gemini-3.7-flash", name: "Gemini 3.7 Flash", pricing: { input: 0.75, output: 3.75 }, to: "gemini-3.8-flash" },
  { type: "github-copilot", from: "mai-code-1-flash-picker", name: "MAI-Code-1-Flash", pricing: { input: 0.75, output: 4.5 }, to: "mai-code-1.1-flash" },
  { type: "opencode", from: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision Exp", pricing: { input: 0.14, output: 0.28 }, to: "deepseek-v4.1-flash" },
  { type: "together", from: "deepseek-ai/DeepSeek-V4-Flash-0731", name: "DeepSeek V4 Flash 0731", pricing: { input: 0.14, output: 0.28 }, to: "deepseek-ai/DeepSeek-V4.1-Flash" },
  { type: "together", from: "MiniMaxAI/MiniMax-M2.7", name: "MiniMax-M2.7", pricing: { input: 0.3, output: 1.2 }, to: "MiniMaxAI/MiniMax-M3" },
  { type: "xiaomi", from: "mimo-v2.5", name: "MiMo-V2.5", pricing: { input: 0.14, output: 0.28 }, to: "mimo-v2.6-flash" },
  { type: "xiaomi", from: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro", pricing: { input: 0.435, output: 0.87 }, to: "mimo-v2.6-pro" },
  { type: "xiaomi", from: "mimo-v2.5-pro-ultraspeed", name: "MiMo-V2.5-Pro-UltraSpeed", pricing: { input: 1.305, output: 2.61 }, to: "mimo-v2.6-pro-ultraspeed" },
  { type: "xiaomi-token-plan-ams", from: "mimo-v2.5", name: "MiMo-V2.5", pricing: { input: 0, output: 0 }, to: "mimo-v2.6-flash" },
  { type: "xiaomi-token-plan-ams", from: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro", pricing: { input: 0, output: 0 }, to: "mimo-v2.6-pro" },
  { type: "xiaomi-token-plan-cn", from: "mimo-v2.5", name: "MiMo-V2.5", pricing: { input: 0, output: 0 }, to: "mimo-v2.6-flash" },
  { type: "xiaomi-token-plan-cn", from: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro", pricing: { input: 0, output: 0 }, to: "mimo-v2.6-pro" },
  { type: "xiaomi-token-plan-sgp", from: "mimo-v2.5", name: "MiMo-V2.5", pricing: { input: 0, output: 0 }, to: "mimo-v2.6-flash" },
  { type: "xiaomi-token-plan-sgp", from: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro", pricing: { input: 0, output: 0 }, to: "mimo-v2.6-pro" },
  // pi-ai 1.4.0 → 1.5.0. Retired without a successor: azure and openai gpt-realtime-2.1; google and
  // google-vertex gemini-3.1-flash-lite-image, and google gemini-3.1-flash-live-preview; huggingface
  // Qwen3-Next-80B-A3B-Thinking and MiMo-V2-Flash; mistral pixtral-large-latest (a moving alias);
  // nvidia z-ai/glm-5.3 (GLM-5.3-Flash is a different tier); opencode longcat-2.5-preview-free,
  // minimax-m3.1-flash-free and nemotron-3-ultra-free; opencode-go longcat-2.5-preview-free and
  // minimax-m3.1-flash-free (the paid M3.1 Flash is a different tier); and vercel-ai-gateway
  // arcee-ai/trinity-large-thinking, openai/gpt-3.5-turbo, gpt-4-turbo, gpt-4.1-nano-batch,
  // gpt-4.1-nano-fast and o4-mini-fast, poolside/laguna-s-2.1-free, and
  // spacexai/grok-4.1-fast-non-reasoning and grok-4.1-fast-reasoning.
  { type: "huggingface", from: "zai-org/GLM-4.5", name: "GLM-4.5", pricing: { input: 0.6, output: 2.2 }, to: "zai-org/GLM-4.7" },
  { type: "mistral", from: "devstral-medium-2507", name: "Devstral Medium", pricing: { input: 0.4, output: 2 }, to: "devstral-2512" },
  { type: "mistral", from: "devstral-small-2505", name: "Devstral Small 2505", pricing: { input: 0.1, output: 0.3 }, to: "labs-devstral-small-2512" },
  { type: "mistral", from: "devstral-small-2507", name: "Devstral Small", pricing: { input: 0.1, output: 0.3 }, to: "labs-devstral-small-2512" },
  { type: "mistral", from: "mistral-large-2411", name: "Mistral Large 2.1", pricing: { input: 2, output: 6 }, to: "mistral-large-2512" },
  { type: "mistral", from: "mistral-nemo", name: "Mistral Nemo", pricing: { input: 0.15, output: 0.15 }, to: "open-mistral-nemo" },
  { type: "opencode", from: "deepseek-v4-flash", name: "DeepSeek V4 Flash", pricing: { input: 0.14, output: 0.28 }, to: "deepseek-v4.1-flash" },
  { type: "opencode-go", from: "gemini-4-argon-contributor", name: "Gemini 4 Argon Contributor", pricing: { input: 4, output: 20 }, to: "gemini-4-argon" },
  // pi-ai 1.5.0 → 1.5.2 (all in 1.5.1). Retired without a successor: fireworks gpt-oss-120b, inkling,
  // nemotron-3-ultra-nvfp4 and nemotron-lightning-3p5-30b-a3b; nvidia
  // meta/llama-3.2-11b-vision-instruct (the 90B is a different tier); and vercel-ai-gateway
  // google/gemini-3.5-flash-batch and gemini-3.7-flash-batch (no newer Flash has a batch id).
  { type: "vercel-ai-gateway", from: "meituan/longcat-2.5-preview", name: "LongCat 2.5 Preview", pricing: { input: 0.3, output: 1.2 }, to: "meituan/longcat-2.5" },
  { type: "vercel-ai-gateway", from: "xiaomi/mimo-v2.5", name: "MiMo M2.5", pricing: { input: 0.119, output: 0.238 }, to: "xiaomi/mimo-v2.6-flash" },
  { type: "vercel-ai-gateway", from: "xiaomi/mimo-v2.5-pro", name: "MiMo V2.5 Pro", pricing: { input: 0.3045, output: 0.609 }, to: "xiaomi/mimo-v2.6-pro" },
];

export function modelAlias(type: LlmProviderType, id: string): ModelAlias | undefined {
  return modelAliases.find((alias) => alias.type === type && alias.from === id);
}
