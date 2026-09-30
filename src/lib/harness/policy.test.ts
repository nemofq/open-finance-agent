import type { AfterToolCallContext, Agent, AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { normalizeContext, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { evidenceTag } from "@/lib/evidence/tags";
import type { EvidenceEntry } from "@/lib/evidence/types";
import { knownEntities } from "@/lib/policy/domains";
import type { RuleContext } from "@/lib/policy/events";
import type { PolicyMode } from "@/lib/policy/types";
import { compose, type Concern, type TurnState } from "./concern";
import { delivery } from "./delivery";
import { policy } from "./policy";
import { answer, scriptedHarness, testRules, testTurn } from "./testing";
import { assistant, toolResult } from "@/lib/context/testing";
import { dataTool, financeTool, generalTool, testLedger, toolCall } from "@/lib/policy/testing";

const earnings = dataTool("alphavantage__EARNINGS", {
  id: "alphavantage",
  name: "Alpha Vantage",
  tier: 2,
  coverage: ["earnings"],
});
const etfProfile = dataTool("alphavantage__ETF_PROFILE", {
  id: "alphavantage",
  name: "Alpha Vantage",
  tier: 2,
  coverage: ["funds"],
});
const quote = dataTool("alphavantage__GLOBAL_QUOTE", {
  id: "alphavantage",
  name: "Alpha Vantage",
  tier: 2,
  coverage: ["prices"],
});
const search = generalTool("web_search");
const createReport = financeTool("create_report");

type Options = Partial<Pick<RuleContext, "tools" | "ledger">> & { mode?: PolicyMode; messages?: AgentMessage[]; skill?: TurnState["skill"] };
function hooksFor(overrides: Options = {}) {
  const tools = overrides.tools ?? [earnings, etfProfile, quote, search, createReport];
  const ledger = overrides.ledger ?? testLedger();
  const turn = testTurn({ ledger, mode: overrides.mode ?? "enforce", skill: overrides.skill });
  const context = testRules(turn, { tools, tickers: knownEntities(ledger, []).tickers }, overrides.messages ?? []);
  const concern = policy(context);
  concern.beforeTurn!(turn, []);
  delivery.beforeTurn!(turn, []);
  const composed = compose([delivery, concern], { tools, skillsIndex: [] }, turn);
  const hooks = { ...composed.agentOptions,
    state: context.state,
    afterToolCall: (hook: ReturnType<typeof afterContext>) => concern.afterTool!({ name: hook.toolCall.name, id: hook.toolCall.id, args: hook.toolCall.arguments, tool: tools.find((t) => t.name === hook.toolCall.name) }, { ...hook.result, details: hook.entry ? { evidence: hook.entry } : hook.result.details, isError: hook.isError }, turn),
    onTurnEnd: async (agent: Agent, event: Extract<AgentEvent, { type: "turn_end" }>) => {
      composed.bind(agent);
      if (event.message.role !== "assistant") return;
      await composed.agentOptions.finishTurn!({ message: event.message, toolResults: [], context: { tools: [], messages: [] }, newMessages: [] });
    },
  };
  return { hooks, checks: turn.checks, turn };
}

function beforeContext(call: ToolCall) {
  return {
    assistantMessage: assistant({ calls: [call], stopReason: "stop" }),
    toolCall: call,
    args: call.arguments,
    context: { systemPrompt: "", messages: [], tools: [] },
  };
}

function afterContext(
  call: ToolCall,
  text: string,
  extra: { entry?: EvidenceEntry; isError?: boolean; details?: unknown } = {},
): AfterToolCallContext & { entry?: EvidenceEntry } {
  return {
    ...beforeContext(call),
    result: { content: [{ type: "text", text }], details: extra.details },
    isError: extra.isError ?? false,
    entry: extra.entry,
  };
}

/** A stand-in for pi's `Agent` that records what the hooks queue. */
function fakeAgent(messages: AgentMessage[] = []): { agent: Agent; followUps: AgentMessage[] } {
  const followUps: AgentMessage[] = [];
  const agent = {
    state: { messages },
    subscribe: () => () => {},
    followUp(message: AgentMessage) {
      followUps.push(message);
    },
  } as unknown as Agent;
  return { agent, followUps };
}

function turnEnd(message: AgentMessage): Extract<AgentEvent, { type: "turn_end" }> {
  return { type: "turn_end", message, toolResults: [] };
}

const webCall = toolCall("call_1", "web_search", { query: "$TSLY ETF distribution yield" });

describe("the policy hooks on pi's Agent", () => {
  it("blocks a tool call with a reason the model can act on", async () => {
    const { hooks, checks } = hooksFor();
    const blocked = await hooks.beforeToolCall!(beforeContext(webCall));

    expect(blocked).toEqual({ block: true, reason: expect.stringContaining("alphavantage__ETF_PROFILE") });
    expect(checks).toHaveLength(1);
  });

  it("rebuilds the connections this chat already tried, so the block lifts", async () => {
    const call = toolCall("call_0", "alphavantage__ETF_PROFILE", { symbol: "TSLY" });
    const messages: AgentMessage[] = [
      assistant({ calls: [call], stopReason: "stop" }),
      toolResult("call_0", "alphavantage__ETF_PROFILE", "TSLY — YieldMax TSLA Option Income Strategy ETF"),
    ];
    const { hooks } = hooksFor({ messages });

    expect(hooks.state.connectionsTried.get("TSLY")).toEqual(new Set(["alphavantage"]));
    expect(await hooks.beforeToolCall!(beforeContext(webCall))).toBeUndefined();
  });

  it("treats a connection that errored as tried and found wanting", async () => {
    const call = toolCall("call_0", "alphavantage__ETF_PROFILE", { symbol: "TSLY" });
    const messages: AgentMessage[] = [
      assistant({ calls: [call], stopReason: "stop" }),
      { ...toolResult("call_0", "alphavantage__ETF_PROFILE", "Rate limit reached"), isError: true },
    ];
    const { hooks } = hooksFor({ messages });

    expect(hooks.state.connectionsFailed.get("TSLY")).toEqual(new Set(["alphavantage"]));
    expect(await hooks.beforeToolCall!(beforeContext(webCall))).toBeUndefined();
  });

  it("lets a web search through beside the connection call it was batched with", async () => {
    // pi preflights the whole batch before running any of it, so the connection counts as tried
    // at preflight; waiting for its result would block the search sitting next to it.
    const { hooks } = hooksFor();
    const connection = toolCall("call_a", "alphavantage__EARNINGS", { symbol: "NVDA" });
    const alongside = toolCall("call_b", "web_search", { query: "$NVDA earnings results stock reaction" });

    expect(await hooks.beforeToolCall!(beforeContext(connection))).toBeUndefined();
    expect(hooks.state.connectionsTried.get("NVDA")).toEqual(new Set(["alphavantage"]));
    expect(await hooks.beforeToolCall!(beforeContext(alongside))).toBeUndefined();
  });

  it("leaves the benchmark's NVDA turn alone once Alpha Vantage has answered", async () => {
    const ledger = testLedger();
    ledger.add({ kind: "E", summary: "EDGAR filings", entity: { ticker: "NVDA", name: "NVIDIA CORP" } });
    const news = dataTool("alphavantage__NEWS_SENTIMENT", {
      id: "alphavantage",
      name: "Alpha Vantage",
      tier: 2,
      coverage: ["news", "macro"],
    });
    const { hooks, checks } = hooksFor({ ledger, tools: [earnings, news, search] });

    const earningsCall = toolCall("call_1", "alphavantage__EARNINGS", { symbol: "NVDA" });
    await hooks.beforeToolCall!(beforeContext(earningsCall));
    await hooks.afterToolCall(afterContext(earningsCall, "NVDA quarterly EPS, 8 periods"));

    // The next batch pairs the connection call with two searches; none of the three may be blocked.
    const batch = [
      toolCall("call_2", "alphavantage__NEWS_SENTIMENT", { tickers: "NVDA" }),
      toolCall("call_3", "web_search", { query: "Nvidia shares Wednesday close earnings results stock reaction" }),
      toolCall("call_4", "web_search", { query: "stock market Wednesday close Nasdaq tech stocks Treasury yields" }),
    ];
    const blocked = [];
    for (const call of batch) blocked.push(await hooks.beforeToolCall!(beforeContext(call)));

    expect(blocked).toEqual([undefined, undefined, undefined]);
    expect(checks.filter((check) => check.rule === "P1")).toHaveLength(0);
  });

  it("does not count a blocked call as a connection tried", async () => {
    const { hooks } = hooksFor();

    await hooks.beforeToolCall!(beforeContext(webCall));

    expect(hooks.state.connectionsTried.size).toBe(0);
  });

  it("records a block without stopping the call in observe mode", async () => {
    const { hooks, checks } = hooksFor({ mode: "observe" });

    expect(await hooks.beforeToolCall!(beforeContext(webCall))).toBeUndefined();
    expect(checks[0]).toMatchObject({ rule: "P1", kind: "block", enforced: false });
  });

  it("puts an annotation under the evidence tag line", async () => {
    const ledger = testLedger();
    const entry = ledger.add({
      kind: "E",
      summary: "quote",
      asOf: "2026-09-08",
      source: { id: "alphavantage", name: "Alpha Vantage", tier: 2 },
    });
    const { hooks } = hooksFor({ ledger });
    const call = toolCall("call_2", "alphavantage__GLOBAL_QUOTE", { symbol: "NVDA" });
    const result = await hooks.afterToolCall(
      afterContext(call, `${evidenceTag(entry)}\nNVDA 178.20 (-0.4%)`, { entry }),
    );

    expect(result?.content?.[0]).toEqual({
      type: "text",
      text: `${evidenceTag(entry)}\nNote: quote is as of 2026-09-08, older than the last completed session 2026-09-10.\nNVDA 178.20 (-0.4%)`,
    });
  });

  it("leaves a result alone when no rule applies", async () => {
    const ledger = testLedger();
    const entry = ledger.add({ kind: "E", summary: "quote", asOf: "2026-09-10" });
    const { hooks } = hooksFor({ ledger });
    const call = toolCall("call_2", "alphavantage__GLOBAL_QUOTE", { symbol: "NVDA" });

    expect(await hooks.afterToolCall(afterContext(call, "NVDA 178.20", { entry }))).toBeUndefined();
  });

  it("sends a follow-up when the answer holds a figure no entry backs", async () => {
    const { hooks, checks } = hooksFor();
    const { agent, followUps } = fakeAgent();

    await hooks.onTurnEnd(agent, turnEnd(assistant({ text: "The margin was 74.6%." })));

    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toMatchObject({
      role: "check",
      check: { rule: "P8", kind: "follow_up", enforced: true, text: expect.stringContaining("74.6%") },
    });
    expect(checks[0]).toMatchObject({ rule: "P8", kind: "follow_up", stage: "before_stop", enforced: true });
  });

  it("says nothing while the agent still has tool calls to make", async () => {
    const { hooks, checks } = hooksFor();
    const { agent, followUps } = fakeAgent();
    const message = assistant({ text: "The margin was 74.6%.", calls: [webCall] });

    await hooks.onTurnEnd(agent, turnEnd(message));

    expect(followUps).toHaveLength(0);
    expect(checks).toHaveLength(0);
  });

  it("says nothing about a turn that ended in an error", async () => {
    const { hooks, checks } = hooksFor();
    const { agent } = fakeAgent();

    await hooks.onTurnEnd(agent, turnEnd(assistant({ text: "74.6%", stopReason: "error" })));

    expect(checks).toHaveLength(0);
  });
});

describe("the calculator the P8 correction offers", () => {
  it("does not request calculator work when a completed report leaves no tools available", async () => {
    const turn = testTurn({ skill: { name: "valuation", output: "valuation" } });
    const context = testRules(turn, { calculatorAvailable: true });
    const rules = policy(context);
    const h = scriptedHarness([delivery, rules], turn, [
      assistant({ calls: [toolCall("report", "create_report", {})] }),
      answer("The margin was 74.6%."), answer("The margin is unverified; the report contains the sourced findings."),
    ], { tools: [generalTool("create_report"), generalTool("financial_calculator")], skillsIndex: [] });
    await h.run();
    expect(h.seen[1].tools).toEqual([]);
    expect(turn.checks[0]).toMatchObject({ rule: "P8", kind: "follow_up", figures: ["74.6%"] });
    expect(turn.checks[0].text).toContain("calculator is unavailable");
    expect(turn.checks[0].text).not.toContain("compute it with financial_calculator");
    expect(h.composed.answer.accepted?.content).toEqual([{ type: "text", text: "The margin is unverified; the report contains the sourced findings." }]);
    // A new request may calculate again; completing one report does not disable the sandbox.
    await h.composed.beforeTurn(h.agent.state.messages);
    h.composed.requestContext(normalizeContext({ messages: [] }));
    expect(rules.beforeRunEnd!("The margin was 72.4%.", turn)).toMatchObject({ text: expect.stringContaining("compute it with financial_calculator") });
  });

  it.each([false, true])("uses the final tool view for corrections, even with a later filter: %s", async (filterLast) => {
    const turn = testTurn();
    const context = testRules(turn, { calculatorAvailable: true });
    const filter: Concern = { name: "read-only", tools: () => [] };
    const rules = policy(context);
    const h = scriptedHarness(filterLast ? [rules, filter] : [filter, rules], turn,
      [answer("The margin was 74.6%."), answer("That margin is unverified.")],
      { tools: [generalTool("financial_calculator")], skillsIndex: [] });
    await h.run();
    expect(turn.checks[0].text).toContain("calculator is unavailable");
  });

  it.each([true, false])("requires both a working sandbox and an offered calculator: %s", async (calculatorAvailable) => {
    const turn = testTurn();
    const context = testRules(turn, { calculatorAvailable });
    const h = scriptedHarness([policy(context)], turn,
      [answer("The margin was 74.6%."), answer("That margin is unverified.")],
      { tools: [generalTool("financial_calculator")], skillsIndex: [] });
    await h.run();
    expect(turn.checks[0].text?.includes("compute it with financial_calculator")).toBe(calculatorAvailable);
  });

  it("removes tools and calculator guidance for a reserved completion", async () => {
    const turn = testTurn({ final: true });
    const context = testRules(turn, { calculatorAvailable: true });
    const h = scriptedHarness([policy(context)], turn,
      [answer("The margin was 74.6%."), answer("That margin is unverified.")],
      { tools: [generalTool("financial_calculator")], skillsIndex: [] });
    await h.run();
    expect(h.seen.every((request) => request.tools?.length === 0)).toBe(true);
    expect(turn.checks[0].text).toContain("calculator is unavailable");
  });
});

describe("a \"use X first\" block (P1) lifts once X was issued this turn", () => {
  const profile = dataTool("alphavantage__ETF_PROFILE", { id: "alphavantage", name: "Alpha Vantage", tier: 2, coverage: ["funds"] });
  const search = generalTool("web_search");
  // The connection is called for another fund than the search names, so only the attempt lifts P1.
  const lookup = (id: string) => toolCall(id, profile.name, { symbol: "QQQ" });
  const find = (id: string) => toolCall(id, search.name, { query: "$TSLY ETF distribution yield" });
  const batch = (...calls: ReturnType<typeof toolCall>[]) => assistant({ calls });

  function setup(replies: ReturnType<typeof assistant>[], options: { before?: Concern[]; profile?: typeof profile } = {}) {
    const turn = testTurn();
    const tools = [options.profile ?? profile, search];
    const context = testRules(turn, { tools });
    const h = scriptedHarness([...(options.before ?? []), policy(context)], turn, replies, { tools, skillsIndex: [] });
    const p1 = () => turn.checks.filter((c) => c.rule === "P1").map((c) => [c.toolCallId, c.kind]);
    const searchResult = (id: string) => h.agent.state.messages.find((m) => m.role === "toolResult" && m.toolCallId === id);
    return { h, turn, p1, searchResult };
  }

  it("blocks a search issued before the connection, as the first occurrence", async () => {
    const { h, p1, searchResult } = setup([batch(find("s1")), answer("Done.")]);
    await h.run();
    expect(p1()).toEqual([["s1", "block"]]);
    expect(searchResult("s1")).toMatchObject({ isError: true });
  });

  it("annotates a search after the connection returned nothing (the retail-06 sequence)", async () => {
    const { h, p1, searchResult } = setup([batch(find("s1")), batch(lookup("c1")), batch(find("s2")), answer("Done.")]);
    await h.run();
    expect(p1()).toEqual([["s1", "block"], ["s2", "annotate"]]);
    expect(searchResult("s2")).toMatchObject({ isError: false });
  });

  it("counts a connection call another concern blocked", async () => {
    const cap: Concern = { name: "cap", beforeTool: (call) => call.name === profile.name ? { block: true, reason: "capped" } : undefined };
    const { h, p1, searchResult } = setup([batch(lookup("c1")), batch(find("s1")), answer("Done.")], { before: [cap] });
    await h.run();
    expect(searchResult("c1")).toMatchObject({ isError: true });
    expect(p1()).toEqual([["s1", "annotate"]]);
  });

  it("counts a connection call that errored", async () => {
    const failing = { ...profile, execute: async () => { throw new Error("rate limited"); } };
    const { h, p1, searchResult } = setup([batch(lookup("c1")), batch(find("s1")), answer("Done.")], { profile: failing });
    await h.run();
    expect(searchResult("c1")).toMatchObject({ isError: true });
    expect(p1()).toEqual([["s1", "annotate"]]);
  });

  it("counts calls of one batch in the order they were issued", async () => {
    const { h, p1 } = setup([batch(find("s1"), lookup("c1"), find("s2")), answer("Done.")]);
    await h.run();
    expect(p1()).toEqual([["s1", "block"], ["s2", "annotate"]]);
  });
});
