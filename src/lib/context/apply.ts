import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Layer 3 seen from the model's side: a checkpoint stands in for everything before it.
 * The saved transcript keeps the full history, so the UI can still show it above the divider.
 */

/** Prefix of the checkpoint the model receives, so it reads as context rather than as an answer. */
const CHECKPOINT_PREFIX = "Research checkpoint (context compacted):";

/**
 * Keep only what follows the last checkpoint, with the checkpoint itself as a user message.
 * compactSession inserts checkpoints only at a findCut boundary, never before a tool result.
 */
export function applyCompaction(messages: AgentMessage[]): AgentMessage[] {
  const last = messages.findLastIndex((message) => message.role === "compaction");
  if (last < 0) return messages;
  const checkpoint = messages[last];
  if (checkpoint.role !== "compaction") return messages;

  return [
    {
      role: "user" as const,
      content: `${CHECKPOINT_PREFIX}\n\n${checkpoint.summary}`,
      timestamp: checkpoint.timestamp,
    },
    ...messages.slice(last + 1),
  ];
}
