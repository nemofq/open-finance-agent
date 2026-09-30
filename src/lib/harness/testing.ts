import { Agent, type AgentMessage, type AgentTurnDecision } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { assistant, fakeModel } from "@/lib/context/testing";
import type { RuleContext } from "@/lib/policy/events";
import { TEST_NOW, testLedger, testTime } from "@/lib/policy/testing";
import { compose, type Concern, FOLLOW_UP_BUDGET, type SessionCtx, type TurnState } from "./concern";
import { ruleContext, type RuleFacts } from "./policy";

/**
 * Helpers the harness tests share: a turn, the rules' view of it, and composed concerns on the
 * installed pi Agent driven by scripted model replies. Not used in production.
 */

export const testTurn = (overrides: Partial<TurnState> = {}): TurnState => ({
  ledger: testLedger(), time: testTime(), request: "compare their growth", followUpsLeft: FOLLOW_UP_BUDGET, checks: [], mode: "enforce", ...overrides,
});
/** The rules' view of a test turn, as the factory builds it: checks and budgets read live from `turn`. */
export const testRules = (turn: TurnState, facts: Partial<RuleFacts> = {}, messages: AgentMessage[] = []): RuleContext =>
  ruleContext(turn, { tools: [], tickers: [], now: () => TEST_NOW, calculatorAvailable: true, ...facts }, messages);
export const answer = (text: string) => assistant({ text });
export function scriptedHarness(concerns: Concern[], turn = testTurn(), replies: AssistantMessage[] = [answer("Done.")], session: SessionCtx = { tools: [], skillsIndex: [] }) {
  const seen: Context[] = [];
  const composed = compose(concerns, session, turn);
  /** What `finishTurn` decided after each reply, in order: nothing, or an end to the run. */
  const decisions: (AgentTurnDecision | undefined)[] = [];
  const { finishTurn } = composed.agentOptions;
  const agent = new Agent({ ...composed.agentOptions,
    finishTurn: async (ctx, signal) => {
      const decision = await finishTurn?.(ctx, signal) ?? undefined;
      decisions.push(decision);
      return decision;
    },
    initialState: { model: fakeModel(32_768), tools: composed.wrapTools(session.tools), systemPrompt: composed.systemPrompt },
    streamFn: (_model, context) => {
      seen.push({ ...composed.requestContext(context), messages: structuredClone(context.messages) });
      const reply = replies.shift();
      if (!reply) throw new Error("Unexpected model call");
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: reply });
      if (reply.stopReason === "error" || reply.stopReason === "aborted") stream.push({ type: "error", reason: reply.stopReason, error: reply });
      else if (reply.stopReason !== "pending") stream.push({ type: "done", reason: reply.stopReason, message: reply });
      stream.end(reply);
      return stream;
    },
  });
  composed.bind(agent);
  return { composed, agent, turn, seen, decisions,
    /**
     * A turn after `messages`, which follow pi's leading system message as a saved chat does in the
     * factory. It fails if `finishTurn` ever asked pi for a request the loop would not have made.
     */
    run: async (messages: AgentMessage[] = []) => {
      await composed.beforeTurn([...agent.state.messages, ...messages]);
      await agent.prompt(turn.request);
      await agent.waitForIdle();
      if (decisions.some((decision) => decision?.action === "continue")) throw new Error("finishTurn asked pi for one more request");
    },
  };
}
