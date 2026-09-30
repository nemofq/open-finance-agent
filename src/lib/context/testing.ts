import type {
  Api,
  AssistantMessage,
  JsonObject,
  Model,
  StopReason,
  TextContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai";
import { NO_USAGE } from "@/lib/agent/messages";
import type { EvidenceEntry, EvidenceId, EvidenceKind } from "@/lib/evidence/types";

/**
 * Test builders for the context and harness tests: a model, entries and messages. Nothing in the
 * app imports this file; it lives here so the tests share one set. A ledger holding entries is
 * `ledgerWith` from `src/lib/evidence/testing.ts`.
 */

/** A model with just the fields a budget is derived from. */
export function fakeModel(contextWindow: number, maxTokens = 8_192): Model<Api> {
  return {
    id: "test-model",
    name: "Test model",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
  };
}

/** An entry with only the fields the context layers read. */
export function entry(id: EvidenceId, patch: Partial<EvidenceEntry> = {}): EvidenceEntry {
  const kind = id[0] as EvidenceKind;
  return {
    id,
    kind,
    summary: `${id} summary`,
    fetchedAt: "2026-09-13T00:00:00Z",
    ...patch,
  };
}

export function usageOf(input: number): Usage {
  return { ...NO_USAGE, input, totalTokens: input };
}

let clock = 1_700_000_000_000;
const nextTime = () => (clock += 1_000);

export function user(text: string): UserMessage {
  return { role: "user", content: text, timestamp: nextTime() };
}

export interface AssistantParts {
  text?: string;
  thinking?: string;
  calls?: { id: string; name: string; arguments: JsonObject }[];
  usage?: Usage;
  /** Defaults to `toolUse` with calls, else `stop`. */
  stopReason?: StopReason;
}

export function assistant(parts: AssistantParts): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  if (parts.thinking) content.push({ type: "thinking", thinking: parts.thinking });
  if (parts.text) content.push({ type: "text", text: parts.text });
  for (const call of parts.calls ?? []) {
    content.push({ type: "toolCall", id: call.id, name: call.name, arguments: call.arguments } satisfies ToolCall);
  }
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: parts.usage ?? NO_USAGE,
    stopReason: parts.stopReason ?? (parts.calls?.length ? "toolUse" : "stop"),
    timestamp: nextTime(),
  };
}

export function failed(errorMessage: string): AssistantMessage {
  return { ...assistant({}), stopReason: "error", errorMessage };
}

export function toolResult(
  toolCallId: string,
  toolName: string,
  text: string,
  evidence?: EvidenceEntry | EvidenceEntry[],
): ToolResultMessage {
  const content: TextContent[] = [{ type: "text", text }];
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content,
    details: evidence ? { evidence } : undefined,
    isError: false,
    timestamp: nextTime(),
  };
}
