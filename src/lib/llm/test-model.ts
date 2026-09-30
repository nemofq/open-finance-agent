/**
 * The Settings "Test" button: one request shaped like an agent turn, then the probes a model's
 * declared capabilities call for (the thinking switch, image input). Kept apart from provider
 * resolution in `index.ts`, which every chat turn loads.
 */
import type { Api, AssistantMessage, Context, Model, Tool } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { LlmProviderConfig, ThinkingLevel } from "@/lib/config/schema";
import { neutralModelInfo } from "@/lib/llm/catalog";
import { probeContext } from "@/lib/llm/probe";
import type { ModelTestResult } from "@/lib/llm/types";
import { blockText } from "@/lib/text/blocks";
import { errorMessage } from "@/lib/utils";
import { providerErrorText } from "./error-text";
import { draftModels } from "./models";
import { providerDefinition } from "./providers";
import { streamDraftModel } from "./stream";
import { testImage } from "./test-image";

function replyText(message: AssistantMessage): string {
  return blockText(message.content, "").trim();
}

/** Sent with the test so a server that cannot take tools fails the test rather than the first chat turn. */
const testTool: Tool = {
  name: "ping",
  description: "Unused; do not call.",
  parameters: Type.Object({}),
};

type TestOptions = { reasoning?: Exclude<ThinkingLevel, "off">; timeoutMs: number };

interface RequestResult {
  ok: boolean;
  latencyMs: number;
  reply: string;
  error?: string;
  /** Reasoning tokens the endpoint reported (0 when it reported none), and whether the reply carried thinking. */
  thought?: { tokens: number; content: boolean };
}

/** One timed request, with a stream that errored out or was cut short reported the way a thrown one is. */
async function runRequest(
  provider: LlmProviderConfig,
  model: Model<Api>,
  context: Context,
  options: TestOptions,
): Promise<RequestResult> {
  const started = Date.now();
  try {
    const message = await streamDraftModel(provider, model, context, options).result();
    const failed = message.stopReason === "error" || message.stopReason === "aborted";
    return {
      ok: !failed,
      latencyMs: Date.now() - started,
      reply: replyText(message),
      ...(failed ? { error: message.errorMessage ? providerErrorText(message.errorMessage) : `Request ${message.stopReason}` } : {}),
      thought: {
        tokens: message.usage?.reasoning ?? 0,
        content: message.content.some((block) => block.type === "thinking" && block.thinking.trim() !== ""),
      },
    };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, reply: "", error: providerErrorText(errorMessage(err)) };
  }
}

/** A request's result as the settings page sees it, without the thinking measurements. */
function shown(result: RequestResult): Omit<RequestResult, "thought"> {
  const { ok, latencyMs, reply, error } = result;
  return error === undefined ? { ok, latencyMs, reply } : { ok, latencyMs, reply, error };
}

/** Leading and trailing punctuation and case are the model's own style, so "OK." and "ok" both read as the word. */
function normalizeWord(reply: string): string {
  return reply
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .toLowerCase();
}

/**
 * The second request: the test image with a prompt to read the word off it. A model that answers
 * anything but "OK" is not looking at the picture, which is what an endpoint that quietly strips
 * image blocks looks like from here, so it fails the probe rather than passing on a plausible reply.
 */
async function probeImages(
  provider: LlmProviderConfig,
  model: Model<Api>,
  options: TestOptions,
): Promise<NonNullable<ModelTestResult["images"]>> {
  const context: Context = {
    systemPrompt: "You are checking that the model can see images. Answer without calling tools.",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "What single word is written in this image? Reply with only that word." }, testImage],
        timestamp: Date.now(),
      },
    ],
    tools: [testTool],
  };
  const result = shown(await runRequest(provider, model, context, options));
  if (!result.ok) return result;
  if (normalizeWord(result.reply) === "ok") return result;
  return { ...result, ok: false, error: "The model did not read the image" };
}

/**
 * Whether thinking really switches, judged from one request at Off and one at a level. What proves
 * it is the reasoning tokens the endpoint reports: none at Off, some at the level. A reply that
 * carries thinking while its usage reports no reasoning tokens means the endpoint does not count
 * them, and then the switch cannot be verified; that is not a pass.
 */
function judgeSwitch(
  off: RequestResult,
  on: RequestResult,
  level: Exclude<ThinkingLevel, "off">,
): NonNullable<ModelTestResult["thinking"]> {
  const offTokens = off.thought?.tokens ?? 0;
  const onTokens = on.thought?.tokens ?? 0;
  const measured = { level, offReasoningTokens: offTokens, onReasoningTokens: onTokens };
  if (!off.ok) return { ...measured, ok: false, message: `The request at off failed: ${off.error ?? "no reply"}` };
  if (!on.ok) return { ...measured, ok: false, message: `The request at ${level} failed: ${on.error ?? "no reply"}` };
  if (offTokens > 0) {
    return { ...measured, ok: false, message: `Thinking could not be switched off: ${offTokens} reasoning tokens at off` };
  }
  if (off.thought?.content) {
    return { ...measured, ok: false, message: "Thinking could not be switched off: the reply at off contained thinking" };
  }
  if (onTokens > 0) {
    return { ...measured, ok: true, message: `Thinking switches: 0 reasoning tokens at off, ${onTokens} at ${level}` };
  }
  if (on.thought?.content) {
    return {
      ...measured,
      ok: false,
      message: `The switch could not be verified: the endpoint returned thinking at ${level} but reports no reasoning-token usage`,
    };
  }
  return {
    ...measured,
    ok: false,
    message: `Thinking could not be switched on: 0 reasoning tokens and no thinking at ${level} (or the endpoint reports no reasoning-token usage)`,
  };
}

/**
 * One-shot "Reply with the single word OK." through `streamModel`, shaped like an agent turn: a
 * system prompt, a tool, the thinking level as reasoning effort, and the model's own output cap.
 * A server that rejects any of those fails the test, not the first chat message.
 *
 * An endpoint model marked for reasoning is also sent the same prompt on the other side of Off
 * (at medium when the level is off), and `thinking` reports whether the reasoning tokens show the
 * declared switch working: none at Off, some at the level.
 *
 * A model flagged as accepting images is then asked to read one, so the Images toggle and the
 * catalog's claim are checked against the endpoint before a chat relies on them. The probe runs
 * only after the text request passed: without it there is nothing to learn from a second failure.
 */
export async function testModel(
  provider: LlmProviderConfig,
  modelId: string,
  thinkingLevel: ThinkingLevel = "off",
): Promise<ModelTestResult> {
  const definition = providerDefinition(provider);
  const listed = await definition.listModels(provider, draftModels(provider)).catch(() => []);
  // A model the provider does not list (a hand-typed id) is tried with neutral capabilities.
  const info = listed.find((model) => model.id === modelId) ?? neutralModelInfo(modelId);
  const model = definition.toPiModel(provider, info);
  const options: TestOptions = {
    reasoning: thinkingLevel === "off" ? undefined : thinkingLevel,
    timeoutMs: 60_000,
  };
  const context: Context = { ...probeContext(), tools: [testTool] };
  const first = await runRequest(provider, model, context, options);
  if (!first.ok) return shown(first);
  const result: ModelTestResult = shown(first);
  // An endpoint model marked for reasoning declares how it is switched, so the test proves the
  // switch: the request above at the configured level, and a second one on the other side of Off.
  if (provider.type === "openai-compatible" && info.supportsReasoning) {
    const level = thinkingLevel === "off" ? "medium" : thinkingLevel;
    const other = await runRequest(provider, model, context, {
      ...options,
      reasoning: thinkingLevel === "off" ? level : undefined,
    });
    result.thinking = thinkingLevel === "off" ? judgeSwitch(first, other, level) : judgeSwitch(other, first, level);
  }
  if (info.supportsImages) result.images = await probeImages(provider, model, options);
  return result;
}
