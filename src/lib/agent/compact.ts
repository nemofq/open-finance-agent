import { getRun } from "@/lib/agent/runs";
import { readConfig } from "@/lib/config/store";
import { resolveContextBudget } from "@/lib/context/budget";
import { compactSession, findCut, summarizer } from "@/lib/context/compact";
import type { CompactionMessage } from "@/lib/context/types";
import { openSessionLedger } from "@/lib/harness/evidence";
import { type ResolutionCode, resolutionCode, resolveModel } from "@/lib/llm";
import { streamModel } from "@/lib/llm/stream";
import { getSession, updateSession } from "@/lib/sessions/store";
import { resolveTimeContext } from "@/lib/time";

/**
 * `/compact [focus]`: compact a saved chat on demand, outside any turn. A turn compacts through
 * the compaction concern instead; both write the checkpoint with the same `summarizer`.
 */

/** Why a chat was not compacted, with the sentence to show; the route picks the status. */
export type CompactChatRefusal =
  | { reason: "session_not_found"; message: string }
  | { reason: "run_in_progress"; message: string }
  | { reason: "nothing_to_compact"; message: string }
  | { reason: "model_unavailable"; message: string; code: ResolutionCode };

export type CompactChatResult = { ok: true; compaction: CompactionMessage } | ({ ok: false } & CompactChatRefusal);

/** Write a checkpoint into the chat's transcript and return it; the whole history is kept. */
export async function compactChat(id: string, options: { focus?: string } = {}): Promise<CompactChatResult> {
  const stored = await getSession(id);
  if (!stored) return { ok: false, reason: "session_not_found", message: "Session not found" };
  // Compacting under a live run would race the agent's own edits to the transcript.
  if (getRun(id)) {
    return { ok: false, reason: "run_in_progress", message: "This chat is still answering. Stop the run before compacting." };
  }

  const config = readConfig();
  const resolved = await resolveModel(config, stored.model, { heldBy: "chat" });
  if (!resolved.ok) {
    return { ok: false, reason: "model_unavailable", message: resolved.message, code: resolutionCode(resolved.reason) };
  }

  const budget = resolveContextBudget(resolved.model);
  const messages = stored.messages;
  // Everything up to the last checkpoint is already summarised; only what follows it can compact.
  const start = messages.findLastIndex((entry) => entry.role === "compaction") + 1;
  if (findCut(messages, start, budget.keepRecent) <= start) {
    return {
      ok: false,
      reason: "nothing_to_compact",
      message: "There is nothing to compact yet: this chat has no earlier turns to summarise.",
    };
  }

  const { messages: compacted, compaction } = await compactSession({
    messages,
    ledger: await openSessionLedger(id, messages),
    budget,
    summarize: summarizer((context) => streamModel(config, resolved.model, context, { conversationId: id })),
    focus: options.focus,
    time: resolveTimeContext({ timeZone: stored.timeZone }),
  });

  await updateSession(id, { messages: compacted });
  return { ok: true, compaction };
}
