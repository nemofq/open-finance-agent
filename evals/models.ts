import type { AppConfig, ModelRef, ThinkingLevel } from "@/lib/config/schema";
import { resolveModel } from "@/lib/llm";
import { modelRefKey } from "@/lib/llm/catalog";
import { transmittedThinking } from "@/lib/llm/thinking";

/**
 * `--agent` and `--judge` take `provider/model`. Provider ids never contain `/` (see
 * `providerIdSchema`), so the first segment is the provider and everything after it is the model,
 * slashes and all: `local/Qwen/Qwen3-32B` is the model `Qwen/Qwen3-32B`.
 */
export function parseModelSpec(spec: string): ModelRef | null {
  const trimmed = spec.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) };
}

/** Parse a spec and check the provider is one this config knows, so failures name the mistake. */
export function resolveModelSpec(config: AppConfig, spec: string): { ok: true; ref: ModelRef } | { ok: false; error: string } {
  const ref = parseModelSpec(spec);
  if (!ref) return { ok: false, error: `“${spec}” is not a provider/model spec, e.g. openrouter/openai/gpt-5.` };
  if (!config.llm.providers.some((provider) => provider.id === ref.provider)) {
    const known = config.llm.providers.map((provider) => provider.id).join(", ") || "none configured";
    return { ok: false, error: `Unknown provider “${ref.provider}” in “${spec}”. Configured providers: ${known}.` };
  }
  return { ok: true, ref };
}

/**
 * Model spec → what `level` put on the wire for each model, resolved as a turn resolves it: the
 * level pi-ai clamps it to and the name the model's config declares for it; recorded so a result
 * says what was sent. A model that does not resolve says why, rather than going missing.
 */
export async function thinkingTransmitted(config: AppConfig, refs: ModelRef[], level: ThinkingLevel): Promise<Record<string, string>> {
  const sent: Record<string, string> = {};
  for (const ref of refs) {
    const resolved = await resolveModel(config, ref);
    sent[modelRefKey(ref)] = resolved.ok
      ? transmittedThinking(resolved.provider, resolved.model, level)
      : `${level} → not resolved: ${resolved.reason}`;
  }
  return sent;
}
