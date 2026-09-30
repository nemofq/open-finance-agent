import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { evidenceOf } from "@/lib/evidence/ids";
import { evidenceTag } from "@/lib/evidence/tags";
import type { EvidenceEntry } from "@/lib/evidence/types";
import { CALCULATOR_TOOL } from "@/lib/calculator/tool-name";
import { createEngine } from "@/lib/policy/engine";
import type { RuleContext } from "@/lib/policy/events";
import { rebuildState, recordConnectionAttempt, recordToolIssued, recordToolResult } from "@/lib/policy/state";
import { blockText } from "@/lib/text/blocks";
import { recordCheck, type Concern, type TurnState } from "./concern";

/** What the rules read that is fixed when the agent is built; the rest comes from the turn. */
export type RuleFacts = Pick<RuleContext, "tools" | "profile" | "privacy" | "tickers" | "now"> & {
  /** Whether the sandbox runs at all; a request may still not offer the calculator. */
  calculatorAvailable: boolean;
};

/**
 * The rules' view of a turn. The checks, the follow-up budget and whether the calculator can be
 * offered are read live from the turn, so the rules never see a stale copy; connections tried in
 * this chat are rebuilt from its transcript.
 */
export function ruleContext(turn: TurnState, facts: RuleFacts, messages: AgentMessage[]): RuleContext {
  const { calculatorAvailable, ...fixed } = facts;
  return { ...fixed, ledger: turn.ledger, time: turn.time, state: rebuildState(messages, facts.tools),
    get checks() { return turn.checks; },
    get followUpsLeft() { return turn.followUpsLeft; },
    get calculatorAvailable() { return calculatorAvailable && !turn.final && (turn.availableTools?.includes(CALCULATOR_TOOL) ?? true); },
  };
}

/** Puts the rules' notes on a result, under its evidence tag line when it has one. */
function annotate(content: (TextContent | ImageContent)[], notes: string[], entry: EvidenceEntry | undefined): (TextContent | ImageContent)[] {
  const note = notes.join("\n");
  const index = content.findIndex((part) => part.type === "text");
  const block = index === -1 ? undefined : content[index];
  if (!block || block.type !== "text") return [{ type: "text", text: note }, ...content];

  const [first, ...rest] = block.text.split("\n");
  const tagged = first !== undefined && (entry ? first === evidenceTag(entry) : /^\[.+\]$/.test(first.trim()));
  const text = tagged ? [first, note, ...rest].join("\n") : `${note}\n${block.text}`;
  return content.map((part, at) => (at === index ? { type: "text", text } : part));
}

export const policy = (context: RuleContext): Concern => {
  let turn: TurnState;
  const engine = createEngine({ context, record: (verdict, stage, call) => recordCheck(turn, verdict, stage, call) });
  return {
    name: "policy",
    // Connections tried span the chat; the tools attempted start empty, since each turn rebuilds the state.
    beforeTurn: (state) => { turn = state; },
    toolIssued: (call) => recordToolIssued(context.state, call.name),
    beforeTool: (call) => {
      const block = engine.beforeTool({ stage: "before_tool", toolName: call.name, toolCallId: call.id, args: call.args, tool: call.tool });
      if (!block) recordConnectionAttempt(context.state, call.tool, call.args);
      return block;
    },
    afterTool: (call, result) => {
      const entry = evidenceOf(result.details).find((e) => e.kind === "E");
      const text = blockText(result.content, "\n");
      const event = { tool: call.tool, toolName: call.name, toolCallId: call.id, args: call.args, entry, text, isError: result.isError, details: result.details };
      recordToolResult(context.state, event);
      const notes = engine.afterTool({ ...event, stage: "after_tool" });
      return notes.length ? { content: annotate(result.content, notes, entry) } : undefined;
    },
    beforeRunEnd: (answer, state) => engine.beforeStop({ stage: "before_stop", text: answer, request: state.request }),
  };
};
