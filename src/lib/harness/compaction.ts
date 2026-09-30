import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isContextOverflow } from "@earendil-works/pi-ai";
import { splitSystemHead } from "@/lib/agent/messages";
import { applyCompaction } from "@/lib/context/apply";
import { contextUsage } from "@/lib/context/budget";
import { compactSession, type Summarize } from "@/lib/context/compact";
import type { CompactionMessage, ContextBudget, ContextUsage } from "@/lib/context/types";
import type { Concern, TurnState } from "./concern";

export interface CompactionOptions {
  budget: ContextBudget;
  summarize: Summarize;
  onCompaction: (message: CompactionMessage, messages: AgentMessage[]) => void;
  onUsage?: (usage: ContextUsage) => void;
}
export const compaction = ({ budget, summarize, onCompaction, onUsage }: CompactionOptions): Concern => {
  let turn: TurnState;
  // The engine places the checkpoint by position in the chat. pi's system message leads a run's
  // transcript; left in, it would make the chat's first question a cut candidate, and the first
  // compaction of a chat would summarise nothing. It goes back in front, where pi looks for it.
  const compact = async (messages: AgentMessage[]) => {
    const { head, chat } = splitSystemHead(messages);
    const result = await compactSession({ messages: chat, ledger: turn.ledger, budget, summarize, time: turn.time });
    const compacted = [...head, ...result.messages];
    onCompaction(result.compaction, compacted);
    onUsage?.(contextUsage(result.messages, budget));
    return compacted;
  };
  const usage = (messages: AgentMessage[]) => contextUsage(splitSystemHead(messages).chat, budget);
  return {
    name: "compaction",
    beforeTurn: async (state, messages) => {
      turn = state;
      const used = usage(messages);
      onUsage?.(used);
      return used.used > budget.compactAt ? compact(messages) : messages;
    },
    transformContext: applyCompaction,
    prepareNextTurn: async ({ context }) => {
      try {
        if (usage(context.messages).used <= budget.compactAt) return undefined;
        return { context: { ...context, messages: await compact(context.messages) } };
      } catch (err) { console.error("[context] compaction failed:", err); }
    },
    afterRun: async (messages) => {
      const failed = messages.at(-1);
      if (failed?.role !== "assistant" || !isContextOverflow(failed, budget.unknownWindow ? undefined : budget.window)) return undefined;
      return { messages: await compact(messages.filter((m) => m !== failed)), reason: "Context overflow" };
    },
  };
};
