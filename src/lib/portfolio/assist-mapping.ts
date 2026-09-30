import type { z } from "zod";
import type { AppConfig } from "@/lib/config/schema";
import { readConfig } from "@/lib/config/store";
import { resolveModel } from "@/lib/llm";
import { streamModel } from "@/lib/llm/stream";
import { type assistMappingInputSchema, fieldNames } from "@/lib/portfolio/schema";
import { blockText } from "@/lib/text/blocks";

/**
 * Asks the configured model which column holds which field. The answer is a suggestion the user
 * still confirms, and only a header the request actually sent can survive: the model cannot invent
 * a column, and it is never asked for a value.
 */

export type AssistMappingInput = z.infer<typeof assistMappingInputSchema>;

export type AssistMappingResult = { ok: true; mapping: Record<string, string> } | { ok: false; message: string };

function mappingPrompt(input: AssistMappingInput): string {
  return `You map brokerage holdings table columns to this exact JSON shape. Return JSON only, with keys from ${fieldNames.join(", ")}; values must be one of the supplied headers or null. Do not calculate values. Headers: ${JSON.stringify(input.headers)}. Sample rows: ${JSON.stringify(input.samples)}`;
}

/** Models like to wrap JSON in prose or a fence, so the first object in the reply is the answer. */
export function extractJson(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The mapping assistant did not return JSON.");
  const parsed: unknown = JSON.parse(match[0]);
  if (typeof parsed !== "object" || parsed === null) throw new Error("The mapping assistant did not return an object.");
  return parsed as Record<string, unknown>;
}

/** The fields the model mapped to a header the request sent; anything else it said is dropped. */
export function keepSentHeaders(suggested: Record<string, unknown>, headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of fieldNames) {
    const value = suggested[field];
    if (typeof value === "string" && headers.includes(value)) mapping[field] = value;
  }
  return mapping;
}

/** A mapping suggested by the default model; refused when there is no default model to ask. */
export async function assistMapping(input: AssistMappingInput, config: AppConfig = readConfig()): Promise<AssistMappingResult> {
  const resolved = await resolveModel(config, config.llm.defaultModel);
  if (!resolved.ok) return { ok: false, message: "Configure a default LLM before using mapping assistance." };

  const message = await streamModel(
    config,
    resolved.model,
    {
      systemPrompt: "You are a cautious data-mapping assistant.",
      messages: [{ role: "user", content: mappingPrompt(input), timestamp: Date.now() }],
      tools: [],
    },
    { timeoutMs: 30_000 },
  ).result();
  return { ok: true, mapping: keepSentHeaders(extractJson(blockText(message.content, "")), input.headers) };
}
