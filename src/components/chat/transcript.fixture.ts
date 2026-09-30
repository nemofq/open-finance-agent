import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { EvidenceEntry } from "@/lib/evidence/types";
import type { CheckRecord } from "@/lib/policy/types";

/** Transcript scaffolding shared by the chat's tests. Not used in production. */

export const assistant = (
  content: Extract<AgentMessage, { role: "assistant" }>["content"],
  timestamp = 0,
): AgentMessage => ({
  role: "assistant",
  content,
  api: "openai-completions",
  provider: "openrouter",
  model: "test",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp,
});

export const record = (fields: Partial<CheckRecord> & Pick<CheckRecord, "rule" | "kind">): CheckRecord => ({
  id: `${fields.rule}-${fields.kind}`,
  timestamp: 0,
  stage: "before_stop",
  mode: "enforce",
  enforced: true,
  reason: "because",
  ...fields,
});

export const entry = (fields: Partial<EvidenceEntry> & Pick<EvidenceEntry, "id" | "kind">): EvidenceEntry => ({
  summary: `entry ${fields.id}`,
  fetchedAt: "2026-09-01T00:00:00.000Z",
  ...fields,
});

/** A tool call whose result registered `evidence`, as the ledger writes it onto `details`. */
export const call = (id: string, name: string, evidence: EvidenceEntry | EvidenceEntry[]): AgentMessage[] => [
  assistant([{ type: "toolCall", id, name, arguments: {} }]),
  {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text: "ok" }],
    details: { evidence },
    isError: false,
    timestamp: 0,
  },
];
