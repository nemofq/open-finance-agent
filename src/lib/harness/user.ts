import { memoryPromptBlock } from "@/lib/memory/prompt";
import type { RuleContext } from "@/lib/policy/events";
import { p12ProfileMismatch } from "@/lib/policy/rules/profile-fit";
import { recordCheck, type Concern } from "./concern";

export const user = (context: RuleContext): Concern => {
  let note: string | undefined;
  return {
    name: "user",
    promptSection: ({ profileBlock, memory }) => {
      return [profileBlock?.trim(), memoryPromptBlock(memory)].filter(Boolean).join("\n\n");
    },
    beforeTurn: (turn) => {
      const verdict = p12ProfileMismatch({ stage: "before_model", text: turn.request }, context);
      if (verdict) recordCheck(turn, verdict, "before_model");
      note = turn.mode === "enforce" ? verdict?.text : undefined;
    },
    turnNote: () => note,
  };
};
