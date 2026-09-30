import { contextUsage } from "@/lib/context/budget";
import { currentTurnStart, stubOldResults } from "@/lib/context/stubs";
import type { ContextBudget, ContextUsage } from "@/lib/context/types";
import { compactToolResult } from "@/lib/context/views";
import { evidenceOf } from "@/lib/evidence/ids";
import type { Concern } from "./concern";

export const view = (budget: ContextBudget, onUsage?: (usage: ContextUsage) => void): Concern => ({
  name: "view",
  transformContext: (messages, turn) => {
    try {
      const out = stubOldResults(messages, { ledger: turn.ledger, budget, currentTurnStart: currentTurnStart(messages) });
      onUsage?.(contextUsage(out, budget));
      return out;
    } catch (err) { console.error("[context] transform failed:", err); return messages; }
  },
  afterTool: (_call, result) => ({ content: compactToolResult(result.content, { budget, entry: evidenceOf(result.details).find((e) => e.kind === "E") }) }),
});
