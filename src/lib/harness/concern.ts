import type { Agent, AgentMessage, AgentOptions, AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Context, JsonObject, Message, Tool, TranscriptContext } from "@earendil-works/pi-ai";
import type { EvidenceLedger } from "@/lib/evidence/types";
import { checkMessage } from "@/lib/policy/summary";
import type { Block, CheckRecord, CheckStage, PolicyMode, Verdict } from "@/lib/policy/types";
import { blockText } from "@/lib/text/blocks";
import type { TimeContext } from "@/lib/time/types";
import { hasToolProtocol, INVALID_ANSWER } from "@/lib/llm/answer";
import { toProviderShape, withoutSystemMessages } from "@/lib/agent/messages";
import type { FinanceTool } from "@/lib/tools/contracts";
import type { Delivery } from "./delivery/resolve";

export interface SessionCtx {
  tools: FinanceTool[];
  skillsIndex: { name: string; description: string }[];
  profileBlock?: string;
  memory?: string;
}
/**
 * Corrections a turn may send back to the model, shared by every rule and concern: enough to fix
 * a real miss, too few to send a weaker model round in circles.
 */
export const FOLLOW_UP_BUDGET = 3;

export interface TurnState {
  ledger: EvidenceLedger; // evidence
  time: TimeContext; // time
  request: string; // compose
  skill?: { name: string; output?: string }; // compose
  delivery?: Delivery; // delivery
  followUpsLeft: number; // compose
  final?: boolean; // compose: reserved completion has no further actions
  availableTools?: string[]; // compose: final tool view of the current model request
  checks: CheckRecord[]; // compose
  mode: PolicyMode; // compose: enforcement applies to all concerns
}
export interface ToolCall { name: string; id: string; args: JsonObject; tool?: FinanceTool }
export interface ToolOutcome extends AgentToolResult<unknown> { isError: boolean }
/** How a run recovers: a replaced context to continue from, or a follow-up the model answers without tools. */
export type Recovery = { messages?: AgentMessage[]; followUp?: string; reason: string; final?: boolean };
export interface Concern {
  name: string;
  promptSection?(session: SessionCtx): string | undefined;
  beforeTurn?(turn: TurnState, messages: AgentMessage[]): void | AgentMessage[] | Promise<void | AgentMessage[]>;
  turnNote?(turn: TurnState): string | undefined;
  transformContext?(messages: AgentMessage[], turn: TurnState): AgentMessage[] | Promise<AgentMessage[]>;
  toLlm?(messages: Message[], turn: TurnState): Message[] | Promise<Message[]>;
  prepareNextTurn?: AgentOptions["prepareNextTurnWithContext"];
  wrapTool?(tool: AgentTool, turn: TurnState): AgentTool;
  tools?(tools: Tool[], turn: TurnState): Tool[];
  toolResult?(call: ToolCall, result: ToolOutcome, turn: TurnState): void;
  /** Every call the model issued, in batch order, before argument checks or any concern's beforeTool. */
  toolIssued?(call: ToolCall, turn: TurnState): void;
  beforeTool?(call: ToolCall, turn: TurnState): Block | undefined;
  afterTool?(call: ToolCall, result: ToolOutcome, turn: TurnState): Partial<ToolOutcome> | undefined | Promise<Partial<ToolOutcome> | undefined>;
  /** A `follow_up` the model revises against (its `text`, else its `reason`), or anything else, recorded as a flag. */
  beforeRunEnd?(answer: string, turn: TurnState): Verdict | undefined;
  afterRun?(messages: AgentMessage[], turn: TurnState): Recovery | undefined | Promise<Recovery | undefined>;
  /** Once the model is done for the turn: the last chance to add a deterministic artifact to the transcript. */
  afterTurn?(messages: AgentMessage[], turn: TurnState): void | Promise<void>;
}

/** The id the next recorded check will get, for an artifact that must name its check before recording it. */
export const nextCheckId = (turn: TurnState): string => `chk_${turn.checks.length + 1}`;

/** All shared checks, including policy's findings, are appended here. */
export function recordCheck(turn: TurnState, verdict: Verdict, stage: CheckStage, call?: Pick<ToolCall, "name" | "id">): CheckRecord {
  const check: CheckRecord = { ...verdict, id: nextCheckId(turn), timestamp: Date.now(), stage,
    ...(call ? { tool: call.name, toolCallId: call.id } : {}), mode: turn.mode, enforced: turn.mode === "enforce" };
  turn.checks.push(check);
  return check;
}

/** Ends the run with its queues untouched, so the reserved completion or `afterRun` takes over. */
const END_RUN = { action: "end" } as const;

export function compose(concerns: Concern[], session: SessionCtx, turn: TurnState) {
  let agent: Agent;
  const systemPrompt = concerns.map((c) => c.promptSection?.(session)?.trim()).filter(Boolean).join("\n\n");
  /** The tools as wrapped for pi to execute (`wrapTools`); each request offers the concerns' view of them. */
  let wrapped: AgentTool[] = [];
  const revisions: { draft: AssistantMessage; check: CheckRecord }[] = [];
  const completion: { accepted?: AssistantMessage; candidate?: AssistantMessage; flagged?: boolean; error?: string } = {};
  const argumentsByCall = new Map<string, unknown>();
  const toolIndex = new Map(session.tools.map((tool) => [tool.name, tool]));
  // pi types a call's arguments `unknown` in its hooks and `any` in its events, but they are the
  // model's JSON arguments, validated against the tool's object schema.
  const call = (tc: { name: string; id: string }, args: unknown): ToolCall => ({ ...tc, args: args as JsonObject, tool: toolIndex.get(tc.name) });
  const agentOptions: Pick<AgentOptions, "transformContext" | "convertToLlm" | "prepareNextTurnWithContext" | "beforeToolCall" | "afterToolCall" | "finishTurn"> = {
    // The concerns reshape the chat alone: pi's system messages never reach the model from the
    // transcript (`requestContext`), so a transform sees what it saw before pi kept them there.
    transformContext: async (messages) => {
      let out: AgentMessage[] = withoutSystemMessages(messages);
      for (const c of concerns) if (c.transformContext) out = await c.transformContext(out, turn);
      return out;
    },
    convertToLlm: async (messages) => {
      let out = toProviderShape(messages);
      for (const c of concerns) if (c.toLlm) out = await c.toLlm(out, turn);
      return out;
    },
    prepareNextTurnWithContext: concerns.find((c) => c.prepareNextTurn)?.prepareNextTurn,
    beforeToolCall: async (ctx) => {
      for (const c of concerns) {
        const block = c.beforeTool?.(call(ctx.toolCall, ctx.args), turn);
        if (block) return block;
      }
    },
    afterToolCall: async (ctx) => {
      let result: ToolOutcome = { ...ctx.result, isError: ctx.isError };
      for (const c of concerns) result = { ...result, ...await c.afterTool?.(call(ctx.toolCall, ctx.args), result, turn) };
      return result;
    },
    // pi runs this before `turn_end`, for a failed or aborted reply too, after which it ends the run
    // whatever this returns; `afterRun` and the execution budget decide what follows. Returning
    // nothing keeps pi's own scheduling: tool results, then queued follow-ups. Never `continue`,
    // which would send one more request after an accepted answer.
    finishTurn: async (ctx) => {
      if (ctx.message.stopReason === "error" || ctx.message.stopReason === "aborted") return;
      if (ctx.message.stopReason === "length") return END_RUN; // Let the reserved completion handle interrupted output.
      if (ctx.message.content.some((b) => b.type === "toolCall")) return;
      if (ctx.message.stopReason !== "stop") return;
      const answer = blockText(ctx.message.content, "\n").trim();
      if (hasToolProtocol(answer)) { completion.error = INVALID_ANSWER; completion.accepted = undefined; return END_RUN; }
      if (!answer) return;
      let flagged = false;
      for (const c of concerns) {
        const verdict = c.beforeRunEnd?.(answer, turn);
        if (!verdict) continue;
        const followUp = verdict.kind === "follow_up" && turn.followUpsLeft > 0;
        const { rule, reason, figures, evidence } = verdict;
        // Field by field, in the order saved checks and the `check` frame have always had.
        const check = recordCheck(turn, { rule, reason, figures, evidence, text: followUp ? verdict.text ?? reason : undefined,
          kind: followUp ? "follow_up" : "flag" }, "before_stop");
        if (!followUp) { flagged ||= check.enforced; continue; }
        turn.followUpsLeft -= 1;
        if (check.enforced) {
          revisions.push({ draft: ctx.message, check });
          agent.followUp(checkMessage(check));
          return;
        }
        break;
      }
      for (const { draft, check } of revisions) {
        draft.superseded = true;
        check.resolved = true;
      }
      revisions.length = 0;
      completion.accepted = ctx.message;
      completion.error = undefined;
      completion.flagged = flagged;
    },
  };
  return {
    systemPrompt,
    agentOptions,
    answer: completion,
    /**
     * The request the provider is sent, built from the harness's own prompt and tools rather than
     * from the transcript's system messages: the prompt with this request's note, the tools the
     * concerns offer, and the chat. pi folds it into one leading system message, as 0.85 sent it.
     */
    requestContext: (context: TranscriptContext): Context => {
      const note = concerns.map((c) => c.turnNote?.(turn)?.trim()).filter(Boolean).join("\n");
      const tools = turn.final ? [] : concerns.reduce((out: Tool[], c) => c.tools?.(out, turn) ?? out, wrapped);
      turn.availableTools = tools.map((tool) => tool.name);
      return {
        systemPrompt: [systemPrompt, note && `Current turn context:\n${note}`].filter(Boolean).join("\n\n"),
        messages: withoutSystemMessages(context.messages),
        tools,
      };
    },
    bind: (bound: Agent) => {
      agent = bound;
      return agent.subscribe((event) => {
        if (event.type === "tool_execution_start") {
          argumentsByCall.set(event.toolCallId, event.args);
          // pi emits this for each call of a batch in order, before preparing it, so a call counts
          // even when argument checks or an earlier concern stop it.
          for (const c of concerns) c.toolIssued?.(call({ name: event.toolName, id: event.toolCallId }, event.args), turn);
        }
        if (event.type === "message_end" && event.message.role === "assistant" && ["stop", "length"].includes(event.message.stopReason) &&
          !event.message.content.some((b) => b.type === "toolCall") &&
          event.message.content.some((b) => b.type === "text" && b.text.trim()) &&
          !hasToolProtocol(blockText(event.message.content, "\n"))) completion.candidate = event.message;
        if (event.type === "tool_execution_end") {
          const tc = { name: event.toolName, id: event.toolCallId };
          for (const c of concerns) c.toolResult?.(call(tc, argumentsByCall.get(tc.id)), { ...event.result, isError: event.isError }, turn);
          argumentsByCall.delete(tc.id);
        }
      });
    },
    wrapTools: (tools: AgentTool[]) => {
      wrapped = [...concerns].reverse().reduce((out, { wrapTool }) => wrapTool ? out.map((t) => wrapTool(t, turn)) : out, tools);
      return wrapped;
    },
    beforeTurn: async (messages: AgentMessage[]) => {
      for (const c of concerns) messages = await c.beforeTurn?.(turn, messages) ?? messages;
      agent.state.messages = messages;
    },
    afterTurn: async (messages: AgentMessage[]) => { for (const c of concerns) await c.afterTurn?.(messages, turn); },
    /** The first recovery offered; a follow-up comes back as the check message to prompt with. */
    afterRun: async (messages: AgentMessage[], fallback?: () => Recovery | undefined): Promise<(Recovery & { prompt?: AgentMessage }) | undefined> => {
      for (const recover of [...concerns.map((c) => c.afterRun), fallback]) {
        const recovery = await recover?.(messages, turn);
        if (!recovery) continue;
        if (recovery.final) { turn.final = true; turn.followUpsLeft = 0; }
        if (!recovery.followUp) return recovery;
        const check = recordCheck(turn, { rule: "H1", kind: "follow_up", reason: recovery.reason, text: recovery.followUp }, "before_stop");
        check.enforced = true;
        const draft = messages.findLast((m) => m.role === "assistant");
        if (draft?.role === "assistant") revisions.push({ draft, check });
        return { ...recovery, prompt: checkMessage(check) };
      }
    },
  };
}
export type Composed = ReturnType<typeof compose>;
