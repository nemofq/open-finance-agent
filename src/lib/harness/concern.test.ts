import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { assistant } from "@/lib/context/testing";
import { generalTool, toolCall } from "@/lib/policy/testing";
import { INVALID_ANSWER } from "@/lib/llm/answer";
import { compose, type Concern, FOLLOW_UP_BUDGET } from "./concern";
import { delivery } from "./delivery";
import { policy } from "./policy";
import { answer, scriptedHarness, testRules, testTurn } from "./testing";

const textOf = (messages: AgentMessage[]) => messages.map((m) => m.role === "user" && typeof m.content === "string" ? m.content : "content" in m && Array.isArray(m.content) ? m.content.flatMap((b) => b.type === "text" ? [b.text] : []).join("\n") : "");

describe("concern composition on the installed pi Agent", () => {
  it("continues after tool calls instead of stopping the loop", async () => {
    const tool = generalTool("lookup");
    const execute = vi.fn(tool.execute);
    const h = scriptedHarness([], testTurn(), [assistant({ calls: [toolCall("t1", "lookup", {})] }), answer("Finished")], { tools: [{ ...tool, execute }], skillsIndex: [] });
    await h.run();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(h.seen).toHaveLength(2);
    expect(h.agent.state.messages.at(-1)).toMatchObject({ content: [{ type: "text", text: "Finished" }] });
  });

  it("runs and awaits beforeTurn replacements before downstream concerns", async () => {
    const original: AgentMessage[] = [{ role: "user", content: "old", timestamp: 1 }];
    const replacement: AgentMessage[] = [{ role: "user", content: "checkpoint", timestamp: 2 }];
    const observed: AgentMessage[][] = [];
    const h = scriptedHarness([
      { name: "compact", beforeTurn: async () => { await Promise.resolve(); return replacement; } },
      { name: "next", beforeTurn: (_turn, messages) => { observed.push(messages); } },
    ]);
    await h.composed.beforeTurn(original);
    expect(observed).toEqual([replacement]);
    expect(h.agent.state.messages).toEqual(replacement);
  });

  it("keeps turn context out of the conversation while preserving transcript transforms", async () => {
    const order: string[] = [];
    const h = scriptedHarness([
      { name: "a", promptSection: () => " first ", turnNote: () => "time", transformContext: (messages) => { order.push("a"); return messages.slice(1); } },
      { name: "b", promptSection: () => "", turnNote: () => "profile", transformContext: (messages) => { order.push("b"); return messages; } },
    ]);
    await h.run([{ role: "user", content: "old", timestamp: 0 }]);
    expect(h.agent.state.systemPrompt).toBe("first");
    expect(order).toEqual(["a", "b"]);
    expect(textOf(h.seen[0].messages)).toEqual([h.turn.request]);
    expect(h.seen[0].systemPrompt).toBe("first\n\nCurrent turn context:\ntime\nprofile");
    expect(textOf(h.agent.state.messages)).not.toContain("time\nprofile");
  });

  it("refreshes delivery context after tools without impersonating a new user turn", async () => {
    const turn = testTurn({ skill: { name: "valuation", output: "valuation" } });
    const h = scriptedHarness([delivery], turn, [
      assistant({ calls: [toolCall("report", "create_report", {})] }), answer("Report ready."),
    ], { tools: [generalTool("create_report")], skillsIndex: [] });
    await h.run();
    expect(h.seen).toHaveLength(2);
    expect(h.seen[0].systemPrompt).toContain("Report pending:");
    expect(h.seen[1].systemPrompt).toContain("The report is final and no tool is available this turn;");
    expect(h.seen[1].systemPrompt).not.toContain("Report pending:");
    expect(h.seen[1].messages.at(-1)).toMatchObject({ role: "toolResult", toolCallId: "report" });
    expect(h.seen[1].messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(h.seen[1].tools).toEqual([]);
    expect(h.agent.state.systemPrompt).not.toContain("Current turn context:");
    expect(h.agent.state.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });

  it("maps app roles, drops flags and superseded drafts, then hydrates provider messages", async () => {
    const seen: string[] = [];
    const c = compose([{ name: "files", toLlm: (messages) => { seen.push(...messages.map((m) => m.role)); return messages; } }], { tools: [], skillsIndex: [] }, testTurn());
    const messages: AgentMessage[] = [
      { role: "skill", skill: "review", request: "original", prompt: "expanded", timestamp: 1 },
      { role: "scheduled", taskId: "t", runId: "r", request: "scheduled original", prompt: "scheduled expanded", timestamp: 2 },
      Object.assign(answer("discard"), { superseded: true }),
      { role: "check", check: { rule: "P11", kind: "flag", reason: "wording", id: "c", timestamp: 1, stage: "before_stop", mode: "enforce", enforced: true }, timestamp: 1 },
    ];
    expect(textOf(await c.agentOptions.convertToLlm!(messages))).toEqual(["expanded", "scheduled expanded"]);
    expect(seen).toEqual(["user", "user"]);
  });

  it("applies tool patches in order and puts the first wrapper outermost", async () => {
    const order: string[] = [];
    const concerns: Concern[] = ["first", "second"].map((name) => ({ name,
      wrapTool: (tool) => ({ ...tool, execute: async (...args) => { order.push(`${name}:in`); const out = await tool.execute(...args); order.push(`${name}:out`); return out; } }),
      afterTool: (_call, result) => { order.push(JSON.stringify(result.details)); return { details: name }; },
    }));
    const h = scriptedHarness(concerns, testTurn(), [assistant({ calls: [toolCall("t", "lookup", {})] }), answer("Done")], { tools: [generalTool("lookup")], skillsIndex: [] });
    await h.run();
    expect(order).toEqual(["first:in", "second:in", "second:out", "first:out", undefined, '"first"']);
    expect(h.agent.state.messages.find((m) => m.role === "toolResult")).toMatchObject({ details: "second" });
  });

  it("the first tool block wins and stops execution", async () => {
    const later = vi.fn();
    const execute = vi.fn(generalTool("lookup").execute);
    const h = scriptedHarness([
      { name: "privacy", beforeTool: () => ({ block: true, reason: "private" }) },
      { name: "later", beforeTool: later },
    ], testTurn(), [assistant({ calls: [toolCall("t", "lookup", {})] }), answer("Done")], { tools: [{ ...generalTool("lookup"), execute }], skillsIndex: [] });
    await h.run();
    expect(execute).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
    expect(h.agent.state.messages.find((m) => m.role === "toolResult")).toMatchObject({ isError: true });
  });

  it("gives delivery the shared budget before correcting figures in the discarded chat draft", async () => {
    const turn = testTurn({ skill: { name: "valuation", output: "valuation" } });
    const context = testRules(turn);
    const h = scriptedHarness([delivery, policy(context)], turn, [answer("The margin was 74.6%."), answer("Summary")]);
    // Mark delivery satisfied on the next model call, as a successful report tool would.
    const stream = h.agent.streamFunction;
    let calls = 0;
    h.agent.streamFunction = (...args) => { if (++calls === 2) turn.delivery!.stage = "created"; return stream(...args); };
    await h.run();
    expect(turn.checks.map((c) => c.rule)).toEqual(["delivery"]);
    expect(turn.followUpsLeft).toBe(2);
    expect(textOf(h.seen[1].messages)).toContain("The margin was 74.6%.");
    expect(h.seen[1].messages.at(-1)).toMatchObject({ role: "user" });
    expect(h.agent.state.messages.filter((m) => m.role === "check")).toHaveLength(1);
  });

  it.each(["enforce", "observe"] as const)("records policy corrections in %s mode", async (mode) => {
    const turn = testTurn({ mode });
    const context = testRules(turn);
    const h = scriptedHarness([policy(context)], turn, [answer("The margin was 74.6%."), answer("The margin was 74.6%.")]);
    await h.run();
    expect(turn.checks[0]).toMatchObject({ rule: "P8", kind: "follow_up", enforced: mode === "enforce", figures: ["74.6%"] });
    expect(h.seen).toHaveLength(mode === "enforce" ? 2 : 1);
    if (mode === "enforce") expect(turn.checks[1]).toMatchObject({ rule: "P8", kind: "flag" });
  });

  it("spends three shared corrections across fresh unsourced figures, then flags", async () => {
    const turn = testTurn();
    const h = scriptedHarness([policy(testRules(turn))], turn,
      ["74.6%", "71.2%", "69.9%", "68.1%"].map((figure) => answer(`The margin was ${figure}.`)));
    await h.run();
    expect(turn.checks.map((c) => c.kind)).toEqual(["follow_up", "follow_up", "follow_up", "flag"]);
    expect(turn.followUpsLeft).toBe(0);
  });

  it("records flags before the first correction and never queues a second correction at once", async () => {
    const h = scriptedHarness([
      { name: "flags", beforeRunEnd: () => ({ rule: "P11", kind: "flag", reason: "flagged" }) },
      { name: "first", beforeRunEnd: () => ({ rule: "P8", kind: "follow_up", reason: "fix", text: "fix" }) },
      { name: "last", beforeRunEnd: () => ({ rule: "delivery", kind: "follow_up", reason: "another", text: "another" }) },
    ], testTurn({ followUpsLeft: 1 }), [answer("draft"), answer("final")]);
    await h.run();
    expect(h.turn.checks.map((c) => [c.rule, c.kind])).toEqual([["P11", "flag"], ["P8", "follow_up"], ["P11", "flag"], ["P8", "flag"], ["delivery", "flag"]]);
  });

  it("chooses the first asynchronous recovery", async () => {
    const later = vi.fn();
    const h = scriptedHarness([{ name: "first", afterRun: async () => ({ messages: [], reason: "recover" }) }, { name: "later", afterRun: later }]);
    expect(await h.composed.afterRun([])).toEqual({ messages: [], reason: "recover" });
    expect(later).not.toHaveBeenCalled();
  });
});

describe("finishTurn", () => {
  it.each(["error", "aborted"] as const)("records no check and queues nothing after an %s reply", async (stopReason) => {
    const turn = testTurn();
    const h = scriptedHarness([policy(testRules(turn))], turn, [{ ...answer("The margin was 74.6%."), stopReason }]);
    await h.run();
    expect(h.decisions).toEqual([undefined]);
    expect(turn.checks).toEqual([]);
    expect(turn.followUpsLeft).toBe(FOLLOW_UP_BUDGET);
    expect(h.agent.hasQueuedMessages()).toBe(false);
    expect(h.composed.answer.accepted).toBeUndefined();
    expect(h.seen).toHaveLength(1);
  });

  it("ends the run on a cut-off answer, for the reserved completion to finish", async () => {
    const h = scriptedHarness([], testTurn(), [{ ...answer("The margin was"), stopReason: "length" }]);
    await h.run();
    expect(h.decisions).toEqual([{ action: "end" }]);
    expect(h.composed.answer.accepted).toBeUndefined();
  });

  it("ends the run on an answer in tool protocol and refuses it", async () => {
    const markup = '<｜DSML｜function_calls><｜DSML｜invoke name="create_report"></｜DSML｜invoke></｜DSML｜function_calls>';
    const h = scriptedHarness([], testTurn(), [answer(markup)]);
    await h.run();
    expect(h.decisions).toEqual([{ action: "end" }]);
    expect(h.composed.answer).toMatchObject({ accepted: undefined, error: INVALID_ANSWER });
  });

  it("leaves pi's scheduling alone after a tool call, a correction and an accepted answer", async () => {
    const turn = testTurn();
    const h = scriptedHarness([policy(testRules(turn))], turn, [
      assistant({ calls: [toolCall("t", "lookup", {})] }), answer("The margin was 74.6%."), answer("The margin could not be sourced."),
    ], { tools: [generalTool("lookup")], skillsIndex: [] });
    await h.run();
    expect(h.decisions).toEqual([undefined, undefined, undefined]);
    expect(turn.checks).toEqual([expect.objectContaining({ rule: "P8", kind: "follow_up", resolved: true })]);
    expect(h.composed.answer.accepted?.content).toEqual([{ type: "text", text: "The margin could not be sourced." }]);
  });
});
