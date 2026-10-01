import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Agent, AgentMessage, AgentTurnDecision } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type SystemMessage, type Tool } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SseEvent } from "@/lib/agent/events";
import { defaultConfig } from "@/lib/config/schema";
import { withModulesOff } from "@/lib/tools/testing";
import { streamModel } from "@/lib/llm/stream";
import { createSession, getSession, updateSession } from "@/lib/sessions/store";
import { fixedTimeContext } from "@/lib/time";
import { checkpointPrompt } from "@/lib/context/checkpoint";
import { compose, type Composed } from "@/lib/harness/concern";
import { answer } from "@/lib/harness/testing";
import { runTurn } from "./turn";
import type { RequestTrace } from "./execution";
import type { TurnResult, TurnStore } from "./turn-types";

vi.mock("@/lib/llm/stream", () => ({ streamModel: vi.fn() }));
/** What each turn's `finishTurn` decided after each reply, across the scenario. */
const { decisions } = vi.hoisted(() => ({ decisions: [] as (AgentTurnDecision | undefined)[] }));
// Unchanged, only watched: the invariants below read each turn's concerns and composed prompt, and
// what its `finishTurn` decided.
vi.mock("@/lib/harness/concern", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/harness/concern")>();
  return { ...actual, compose: vi.fn((...args: Parameters<typeof actual.compose>) => {
    const composed = actual.compose(...args);
    const { finishTurn } = composed.agentOptions;
    composed.agentOptions.finishTurn = async (...turn) => {
      const decision = await finishTurn?.(...turn) ?? undefined;
      decisions.push(decision);
      return decision;
    };
    return composed;
  }) };
});
let home: string;
let replies: AssistantMessage[];
let seen: Context[];
/** Each model request as sent, beside what the harness meant it to carry; empty for a checkpoint request. */
let requests: { sent: RequestView; meant: RequestView }[];

interface RequestView { systemPrompt?: string; tools?: string[] }

const CHECKPOINT = checkpointPrompt({ transcript: "", evidenceIndex: "" }).system;

/**
 * What the running turn's harness means a request to carry: the prompt it composed, then this
 * request's turn note, and its concerns' view of the turn's tools, none once the reserved
 * completion runs. Read from the concerns themselves when the request is made, so it holds
 * whatever pi hands the stream function.
 */
function meant(): RequestView {
  const { calls, results } = vi.mocked(compose).mock;
  const [concerns, session, turn] = calls[calls.length - 1];
  const composed = results[results.length - 1].value as Composed;
  const note = concerns.map((c) => c.turnNote?.(turn)?.trim()).filter(Boolean).join("\n");
  const offered: Tool[] = session.tools;
  const tools = turn.final ? [] : concerns.reduce((out, c) => c.tools?.(out, turn) ?? out, offered);
  return { systemPrompt: `${composed.systemPrompt}\n\nCurrent turn context:\n${note}`, tools: tools.map((tool) => tool.name) };
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-turn-integration-"));
  process.env.OFA_HOME = home;
  replies = [];
  seen = [];
  requests = [];
  decisions.length = 0;
  vi.mocked(streamModel).mockImplementation((_config, _model, context) => {
    seen.push({ ...context, messages: structuredClone(context.messages) });
    // A research checkpoint is the summarizer's own request, not a turn of the chat.
    const checkpoint = context.systemPrompt === CHECKPOINT;
    requests.push({ sent: checkpoint ? {} : { systemPrompt: context.systemPrompt, tools: context.tools?.map((tool) => tool.name) },
      meant: checkpoint ? {} : meant() });
    const message = replies.shift();
    if (!message) throw new Error("Unexpected model call");
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message });
    if (message.stopReason === "error" || message.stopReason === "aborted") stream.push({ type: "error", reason: message.stopReason, error: message });
    else if (message.stopReason !== "pending") stream.push({ type: "done", reason: message.stopReason, message });
    stream.end(message);
    return stream;
  });
});
// Every scenario, the continuation after compaction and the reserved completion included, sends
// the whole composed prompt with its turn note and exactly the tools the concerns offered.
afterEach(() => {
  expect(requests.map(({ sent }) => sent)).toEqual(requests.map(({ meant }) => meant));
});
// Nor does any scenario ask pi for a request its loop would not have made on its own.
afterEach(() => {
  expect(decisions).not.toContainEqual({ action: "continue" });
});
afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
  vi.clearAllMocks();
});

/** The request traces the turn stamped on the assistant messages it kept. */
function requestsOf(result: TurnResult): RequestTrace[] {
  return result.messages.flatMap((message) => (message.role === "assistant" && message.execution ? [message.execution] : []));
}

async function input() {
  const config = defaultConfig();
  withModulesOff(config);
  config.llm.providers = [{ id: "offline", type: "openai-compatible", name: "Offline", apiKey: "",
    baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "test-model", contextWindow: 32_768 }] }];
  const session = await createSession({ model: { provider: "offline", model: "test-model" } });
  const events: SseEvent[] = [];
  return { config, session, text: "What does my $500 budget mean?", time: fixedTimeContext({ asOf: "2024-08-29" }),
    titles: false, store: { update: updateSession, get: getSession }, sink: (event: SseEvent) => { events.push(event); }, events };
}

describe("runTurn with composed concerns", () => {
  it("completes from existing evidence after bounded unsuccessful research", async () => {
    const args = await input();
    args.config.modules.evidence.enabled = true;
    replies = Array.from({ length: 2 }, (_, i) => ({ ...answer(""), stopReason: "toolUse" as const, content: [
      { type: "toolCall" as const, id: `lookup-${i}`, name: "evidence_get", arguments: { id: `E${90 + i}` } },
    ] }));
    replies.push(answer("The requested source is unavailable; I cannot establish the company figures."));
    // Every lookup throws, so it is the failed-round budget that ends research, not the stalled one.
    const result = await runTurn({ ...args, execution: { failedCalls: 2 } });
    expect(result.status).toBe("complete");
    expect(result.error).toBeUndefined();
    // The bounded answer finished the turn, so nothing stopped it.
    expect(result.stop).toBeUndefined();
    expect(requestsOf(result).map((r) => r.phase)).toEqual(["analysis", "analysis", "recovery"]);
    expect(seen.at(-1)!.tools).toEqual([]);
  });

  it("names a deadline stop with a typed reason beside its message", async () => {
    const args = await input();
    const result = await runTurn({ ...args, execution: { deadlineAt: Date.now() - 1 } });
    expect(result.error).toBe("The turn reached its execution deadline");
    expect(result.stop).toBe("deadline");
  });

  it("stops calling a tool that keeps failing and finishes from what it has", async () => {
    const args = await input();
    args.config.modules.evidence.enabled = true;
    replies = Array.from({ length: 4 }, (_, i) => ({ ...answer(""), stopReason: "toolUse" as const, content: [
      { type: "toolCall" as const, id: `lookup-${i}`, name: "evidence_get", arguments: { id: `E${90 + i}` } },
    ] }));
    replies.push(answer("The requested source is unavailable; I cannot establish the company figures."));
    const result = await runTurn(args);
    const results = result.messages.filter((message) => message.role === "toolResult");
    expect(results.map((message) => message.isError)).toEqual([true, true, true, true]);
    expect(results[3].content).toEqual([{ type: "text", text: "evidence_get failed 3 times in a row with the same kind of error; finish from what you have" }]);
    expect(result.finalText).toBe("The requested source is unavailable; I cannot establish the company figures.");
    expect(requestsOf(result).map((r) => r.phase)).toEqual(["analysis", "analysis", "analysis", "analysis", "analysis"]);
  });

  it.each([false, true])("rejects report tool markup before grounding (completion also malformed: %s)", async (repeated) => {
    const args = await input();
    args.config.modules.reports.enabled = true;
    const markup = '<｜DSML｜function_calls><｜DSML｜invoke name="create_report"><｜DSML｜parameter name="draftId">R1</｜DSML｜parameter><｜DSML｜parameter name="sectionIndex">18</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜function_calls>';
    replies = [{ ...answer(""), stopReason: "toolUse", content: [
      { type: "toolCall", id: "report", name: "create_report", arguments: { title: "Budget", sections: [
        { heading: "Findings", blocks: [{ type: "text", text: "Your budget is {U1}." }] },
      ] } },
    ] }, answer(markup), answer(repeated ? markup : "Your budget is USD 500 [U1].")];
    const result = await runTurn(args);
    expect(result.evidence.filter((e) => e.kind === "R")).toHaveLength(1);
    expect(result.checks.some((check) => check.rule === "P8")).toBe(false);
    expect(requestsOf(result).map((r) => r.phase)).toEqual(["analysis", "final", "recovery"]);
    expect(result.finalText).not.toContain("DSML");
    expect(result.draftText).toBeUndefined();
    expect(result.status).toBe(repeated ? "failed" : "complete");
    if (repeated) {
      expect(result.error).toContain("tool protocol");
      expect(args.events).toContainEqual(expect.objectContaining({ type: "error", message: result.error }));
    }
    else {
      expect(result.error).toBeUndefined();
      expect(result.finalText).toBe("Your budget is USD 500 [U1].");
      expect(result.checks).toContainEqual(expect.objectContaining({ rule: "H1", resolved: true }));
    }
  });

  it("preserves the caller's tool seam wrapper through composed tool execution", async () => {
    const args = await input();
    args.config.modules.scheduled.enabled = true;
    const params = { taskId: "budget-review" };
    const recorded = { content: [{ type: "text" as const, text: "Task deleted by replay." }], details: {} };
    const execute = vi.fn(async () => recorded);
    replies = [{ ...answer(""), stopReason: "toolUse", content: [
      { type: "toolCall", id: "task", name: "scheduled_task_delete", arguments: params },
    ] }, answer("Your budget is USD 500 [U1].")];
    const result = await runTurn({ ...args, wrapTool: (tool) => ({ ...tool, execute }) });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]).toEqual(expect.arrayContaining(["task", params]));
    expect(result.status).toBe("complete");
    expect(result.error).toBeUndefined();
    expect(result.messages.find((message) => message.role === "toolResult")).toMatchObject({
      toolName: "scheduled_task_delete", content: recorded.content, isError: false,
    });
    expect(JSON.stringify(seen[1].messages)).toContain(recorded.content[0].text);
  });

  it("finishes analysis drafted beside a tool call instead of accepting only a disclaimer", async () => {
    const analysis = "| Budget | Expenses | Reserve |\n|---|---|---|\n| $500 [U1] | $200 [U2] | $300 [U3] |";
    const conclusion = "Your USD 500 budget [U1] covers USD 200 of expenses [U2] and a USD 300 reserve [U3].";
    replies = [{ ...answer(analysis), stopReason: "toolUse", content: [
      { type: "text", text: analysis },
      { type: "toolCall", id: "task", name: "scheduled_task_delete", arguments: { taskId: "budget-review" } },
    ] }, answer("This is research, not investment advice."), { ...answer(""), stopReason: "toolUse", content: [
      { type: "toolCall", id: "report", name: "create_report", arguments: { title: "Budget comparison", sections: [
        { heading: "Findings", blocks: [{ type: "text", text: "The {U1} budget covers {U2} of expenses and a {U3} reserve." }] },
      ] } },
    ] }, answer(conclusion)];
    const args = await input();
    args.text = "Compare my $500 budget with $200 of expenses and a $300 reserve.";
    args.config.modules.scheduled.enabled = true;
    args.config.modules.reports.enabled = true;
    const result = await runTurn(args);
    expect(result.finalText).toBe(conclusion);
    expect(result.status).toBe("complete");
    expect(result.followUps).toBe(1);
    expect(result.evidence.some((entry) => entry.kind === "R")).toBe(true);
    expect(seen).toHaveLength(4);
    expect(seen[1].systemPrompt).toContain("Report pending:");
    const saved = (await getSession(args.session.id))!;
    expect(saved.messages.find((message) => message.role === "assistant" &&
      message.content.some((block) => block.type === "text" && block.text === "This is research, not investment advice.")))
      .toMatchObject({ superseded: true });
    replies = [answer("Your reserve is USD 300 [U3].")];
    const next = await runTurn({ ...args, session: saved, text: "Quick check: how much is the reserve?" });
    expect(next.finalText).toBe("Your reserve is USD 300 [U3].");
    expect(next.followUps).toBe(0);
    expect(seen.at(-1)!.tools?.some((tool) => tool.name === "create_report")).toBe(false);
  });

  it("resolves its own references in the answer without a model call and saves the resolved answer", async () => {
    replies = [answer("Your budget is {U1}.")];
    const args = await input();
    const result = await runTurn(args);
    expect(result.finalText).toBe("Your budget is USD 500 [U1].");
    expect(result.status).toBe("complete");
    expect(result.followUps).toBe(0);
    expect(result.checks).toContainEqual(expect.objectContaining({ rule: "delivery", kind: "annotate", reason: "Evidence placeholders resolved by the harness", evidence: ["U1"] }));
    expect(seen).toHaveLength(1);
    expect(args.events.filter((event) => event.type === "answer_updated")).toEqual([{ type: "answer_updated", text: result.finalText }]);
    const saved = (await getSession(args.session.id))!;
    expect(saved.messages.findLast((m) => m.role === "assistant")).toMatchObject({ content: [{ type: "text", text: result.finalText }] });
    replies = [answer("The source is your stated budget.")];
    const events: SseEvent[] = [];
    await runTurn({ ...args, session: saved, text: "What is the source?", sink: (event) => { events.push(event); } });
    expect(events.some((event) => event.type === "answer_updated")).toBe(false);
    expect(JSON.stringify(seen.at(-1)!.messages)).toContain(result.finalText);
    expect(JSON.stringify(seen.at(-1)!.messages)).not.toContain("Your budget is {U1}.");
  });

  it("corrects an unresolved answer reference instead of accepting a placeholder", async () => {
    replies = [answer("The margin is {E99:margin:2024-06-30}."), answer("The margin remains unavailable.")];
    const result = await runTurn(await input());
    expect(result.finalText).toBe("The margin remains unavailable.");
    expect(result.followUps).toBe(1);
    expect(result.checks[0]).toMatchObject({ rule: "delivery", kind: "follow_up", resolved: true });
    expect(seen).toHaveLength(2);
  });

  it("corrects a report conclusion while preserving the original tool arguments", async () => {
    const spec = { title: "Budget", sections: [{ heading: "Facts", blocks: [{ type: "text", text: "Your budget is {U1}." }] }] };
    replies = [{ ...answer(""), stopReason: "toolUse", content: [
      { type: "toolCall", id: "budget-report", name: "create_report", arguments: spec },
    ] }, answer("Your budget is {U1}.")];
    const args = await input();
    args.config.modules.reports.enabled = true;
    const result = await runTurn(args);
    expect(result.finalText).toBe("Your budget is USD 500 [U1].");
    expect(result.followUps).toBe(0);
    expect(result.evidence.some((entry) => entry.kind === "R")).toBe(true);
    expect(result.messages.find((message) => message.role === "assistant")?.content)
      .toEqual([{ type: "toolCall", id: "budget-report", name: "create_report", arguments: spec }]);
    expect(seen).toHaveLength(2);
  });

  it("still checks unsupported literal figures beside resolved references", async () => {
    replies = [answer("Your budget is {U1}, with a 91.234% return."), answer("Your budget is {U1}; returns are unknown.")];
    const result = await runTurn(await input());
    expect(result.finalText).toBe("Your budget is USD 500 [U1]; returns are unknown.");
    expect(result.checks).toContainEqual(expect.objectContaining({ rule: "P8", kind: "follow_up", resolved: true }));
    expect(seen).toHaveLength(2);
  });

  it("persists corrections and superseded drafts once, streams checks, and keeps correction figures out of user evidence", async () => {
    replies = [answer("The margin was 74.6%."), answer("The margin is unavailable.")];
    const args = await input();
    const result = await runTurn(args);
    expect(result.error).toBeUndefined();
    expect(result.followUps).toBe(1);
    expect(result.finalText).toBe("The margin is unavailable.");
    expect(result.evidence.filter((e) => e.kind === "U").map((e) => e.value)).toEqual([500]);
    expect(seen[0].systemPrompt).toContain('[U1] User said:');
    expect(seen[0].systemPrompt).toContain('not independently verified');
    expect(args.events.filter((e) => e.type === "check")).toEqual(result.checks.map((check) => ({ type: "check", check })));
    const saved = (await getSession(args.session.id))!;
    expect(saved.messages.filter((m) => m.role === "check")).toHaveLength(1);
    expect(saved.messages.find((m) => m.role === "assistant")).toMatchObject({ superseded: true });
    expect(JSON.stringify(seen[1].messages)).toContain("The margin was 74.6%.");
    expect(result.checks[0].resolved).toBe(true);
    replies = [answer("Still unavailable.")];
    const next = await runTurn({ ...args, session: saved, text: "And now?" });
    expect(next.error).toBeUndefined();
    expect(JSON.stringify(seen.at(-1)!.messages)).not.toContain(JSON.stringify(result.checks[0].text));
    expect(next.evidence.filter((e) => e.kind === "U")).toEqual([]);
  });

  it("recovers a reasoning-only cutoff once and persists its H1 check", async () => {
    replies = [{ ...answer(""), content: [{ type: "thinking", thinking: "long reasoning" }], stopReason: "length" }, answer("Here is the answer.")];
    const args = await input();
    const result = await runTurn(args);
    expect(result.finalText).toBe("Here is the answer.");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ rule: "H1", kind: "follow_up", enforced: true });
    expect((await getSession(args.session.id))!.messages.filter((m) => m.role === "check")).toHaveLength(1);
    expect(seen).toHaveLength(2);
  });

  it("hands truncated tool calls to the reserved completion instead of retrying them", async () => {
    replies = [{ ...answer(""), stopReason: "length", content: [
      { type: "toolCall", id: "partial-report", name: "create_report", arguments: { title: "Partial", sections: [] } },
    ] }, answer("The requested evidence remains unavailable.")];
    const args = await input();
    args.config.modules.reports.enabled = true;
    const result = await runTurn(args);
    expect(result.error).toBeUndefined();
    expect(result.finalText).toBe("The requested evidence remains unavailable.");
    expect(requestsOf(result).map((request) => request.phase)).toEqual(["analysis", "recovery"]);
    expect(result.checks).toContainEqual(expect.objectContaining({ rule: "H1", kind: "follow_up", resolved: true }));
    expect(result.evidence.some((entry) => entry.kind === "R")).toBe(false);
    expect(seen).toHaveLength(2);
    expect(seen[0].tools?.some((tool) => tool.name === "create_report")).toBe(true);
    expect(seen[1].tools).toEqual([]);
    const saved = (await getSession(args.session.id))!;
    expect(saved.messages.find((message) => message.role === "assistant")).toMatchObject({ stopReason: "length", superseded: true });
    expect(saved.messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
  });

  it("flags remaining problems after reserved completion without requesting another correction", async () => {
    replies = [{ ...answer(""), stopReason: "length" }, answer("The margin is 91.234%.")];
    const result = await runTurn(await input());
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("partial");
    expect(result.finalText).toBe("The margin is 91.234%.");
    expect(result.checks).toContainEqual(expect.objectContaining({ rule: "P8", kind: "flag" }));
    expect(requestsOf(result).map((r) => r.phase)).toEqual(["analysis", "recovery"]);
    expect(seen).toHaveLength(2);
  });

  it("uses a chat completion note when recovery interrupts a pending report", async () => {
    replies = [{ ...answer(""), stopReason: "length" }, answer("| Scenario | Budget |\n|---|---|\n| A | $500 [U1] |\n| B | $500 [U1] |\n| C | $500 [U1] |")];
    const args = await input();
    const result = await runTurn({ ...args, text: "Write a report comparing their growth." });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("partial");
    expect(result.checks).toContainEqual(expect.objectContaining({ rule: "delivery", kind: "flag" }));
    expect(seen[1].systemPrompt).toContain("Report delivery cannot continue");
    expect(seen[1].tools).toEqual([]);
    expect(seen).toHaveLength(2);
  });

  it("awaits overflow compaction, persists the checkpoint, and continues the original request", async () => {
    replies = [{ ...answer(""), stopReason: "error", errorMessage: "prompt is too long: 40000 tokens > 32768 maximum" },
      answer("No prior research."), answer("Recovered answer.")];
    const args = await input();
    const result = await runTurn(args);
    expect(result.error).toBeUndefined();
    expect(result.finalText).toBe("Recovered answer.");
    expect(result.compactions).toHaveLength(1);
    const messages = (await getSession(args.session.id))!.messages;
    expect(messages.filter((m) => m.role === "compaction")).toHaveLength(1);
    expect(messages.filter((m) => m.role === "assistant" && m.stopReason === "error")).toHaveLength(0);
    expect(JSON.stringify(seen.at(-1)?.messages)).toContain(args.text);
    expect(JSON.stringify(seen.at(-1)?.messages)).toContain("Research checkpoint");
    // The summary is asked in the chat's own name, which OpenCode routes the request by.
    const summary = vi.mocked(streamModel).mock.calls.find(([, , context]) => context.systemPrompt === CHECKPOINT);
    expect(summary?.[3]).toMatchObject({ conversationId: args.session.id });
  });

  it("does not revise or recover an aborted answer", async () => {
    replies = [{ ...answer("74.6%"), stopReason: "aborted" }];
    const result = await runTurn(await input());
    expect(result.aborted).toBe(true);
    expect(result.checks).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it.each(["error", "length"] as const)("retains a rejected draft when correction and recovery end with %s", async (stopReason) => {
    const interrupted: AssistantMessage = stopReason === "error"
      ? { ...answer(""), stopReason, errorMessage: "terminated" }
      : { ...answer(""), stopReason, content: [{ type: "thinking", thinking: "Unfinished reasoning" }] };
    replies = [answer("The margin was 74.6%."),
      structuredClone(interrupted), structuredClone(interrupted)];
    const args = await input();
    const result = await runTurn(args);
    expect(result.status).toBe("partial");
    expect(result.error).toBe(stopReason === "error" ? "terminated" : undefined);
    expect(result.draftText).toBe("The margin was 74.6%.");
    expect(result.finalText).not.toContain("74.6%");
    expect(result.finalText).toContain("could not complete a verified answer");
    expect(seen).toHaveLength(3);
    expect(JSON.stringify(seen[2].messages)).toContain("The margin was 74.6%.");
    const saved = (await getSession(args.session.id))!;
    expect(saved.messages.find((m) => m.role === "assistant")).not.toHaveProperty("superseded");
    expect(requestsOf(result).map((r) => r.phase)).toEqual(["analysis", "analysis", "recovery"]);
  });

  it("recovers a terminated stream without repeating completed tools", async () => {
    replies = [{ ...answer(""), stopReason: "error", errorMessage: "terminated" }, answer("The required source is unavailable.")];
    const result = await runTurn(await input());
    expect(result.status).toBe("complete");
    expect(result.error).toBeUndefined();
    expect(seen[1].tools).toEqual([]);
    expect(requestsOf(result)[0]).toMatchObject({ error: { message: "terminated" } });
    expect(requestsOf(result).every((r) => r.endedAt !== undefined)).toBe(true);
  });
});

describe("pi's system messages", () => {
  it("stay out of the saved chat, the turn's result, its events and every request", async () => {
    replies = [answer("Here is the answer.")];
    const args = await input();
    args.config.modules.evidence.enabled = true;
    let agent: Agent | undefined;
    // With nothing left for pi to execute, it declares the change in a system message of its own.
    const result = await runTurn({ ...args, onAgent: (built) => { agent = built; built.state.tools = []; } });
    expect(result.status).toBe("complete");
    // pi's leading message, with the prompt and the tools, and the change it declared at the prompt.
    expect(agent?.state.messages.map((message) => message.role)).toEqual(["system", "system", "user", "assistant"]);
    const saved = await getSession(args.session.id);
    expect(saved?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(result.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(args.events.filter((event) => event.type === "message_start")).toHaveLength(2);
    expect(args.events.flatMap((event) => event.type === "message_end" ? [event.message.role] : [])).toEqual(["user", "assistant"]);
    expect(seen[0].messages.map((message) => message.role)).toEqual(["user"]);
  });

  it("never displace the prompt: a chat file holding a stray one loads, and the request carries the fresh prompt", async () => {
    replies = [answer("Your budget is unchanged.")];
    const args = await input();
    const stray: SystemMessage = { role: "system", content: "A prompt saved by an older build.", timestamp: 1 };
    const earlier: AgentMessage[] = [stray, { role: "user", content: "Is my budget set?", timestamp: 2 }, answer("Yes.")];
    const session = await updateSession(args.session.id, { messages: earlier });
    if (!session) throw new Error("the chat was not saved");
    let agent: Agent | undefined;
    const result = await runTurn({ ...args, session, onAgent: (built) => { agent = built; } });
    expect(result.status).toBe("complete");
    const composed = vi.mocked(compose).mock.results.at(-1)?.value as Composed;
    expect(agent?.state.messages[0]).not.toBe(stray);
    expect(agent?.state.systemPrompt).toBe(composed.systemPrompt);
    // The invariant above checks the prompt sent is the composed one; the stray one went nowhere.
    expect(JSON.stringify(seen)).not.toContain("older build");
    expect(seen[0].messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect((await getSession(args.session.id))?.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });
});

describe("runTurn's final save", () => {
  const saidLast = async (id: string, text: string) =>
    expect((await getSession(id))!.messages.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text }] });

  it("emits done only after the last write has landed", async () => {
    replies = [answer("Here is the answer.")];
    const args = await input();
    const log: string[] = [];
    // Every write waits for the test to release it, so the turn can be caught with one in flight.
    const held: (() => Promise<unknown>)[] = [];
    const store: TurnStore = {
      update: (id, patch) => new Promise((resolve, reject) => {
        held.push(() => updateSession(id, patch).then((saved) => { log.push("saved"); resolve(saved); }, reject));
      }),
    };
    let settled = false;
    const turn = runTurn({ ...args, store, sink: (event) => { log.push(event.type); } }).finally(() => { settled = true; });
    let writes = 0;
    while (!settled) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const release = held.shift();
      if (!release) continue;
      expect(log).not.toContain("done");
      writes += 1;
      await release();
    }
    const result = await turn;
    expect(result.status).toBe("complete");
    expect(writes).toBeGreaterThan(1);
    expect(held).toEqual([]);
    expect(log.slice(-2)).toEqual(["saved", "done"]);
    await saidLast(args.session.id, "Here is the answer.");
  });

  it("reports a failed final save as the turn's error instead of done, without stopping the run", async () => {
    replies = [answer("Here is the answer.")];
    const args = await input();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let attempts = 0;
    const store: TurnStore = { update: async () => { attempts += 1; throw new Error("disk full"); } };
    const result = await runTurn({ ...args, store });
    expect(logged).toHaveBeenCalledWith("[sessions] persist failed:", expect.any(Error));
    logged.mockRestore();
    // The writes after each message failed too, and the run still went on to its answer.
    expect(attempts).toBeGreaterThan(1);
    expect(result.finalText).toBe("Here is the answer.");
    expect(result.error).toBe("The chat could not be saved: disk full");
    expect(result.status).toBe("partial");
    expect(args.events.at(-1)).toEqual({ type: "error", message: result.error });
    expect(args.events.some((event) => event.type === "done")).toBe(false);
  });

  it("still ends with done when only a write before the last one failed", async () => {
    replies = [answer("Here is the answer.")];
    const args = await input();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let attempts = 0;
    const store: TurnStore = {
      update: async (id, patch) => {
        if ((attempts += 1) === 1) throw new Error("disk busy");
        return updateSession(id, patch);
      },
    };
    const result = await runTurn({ ...args, store });
    logged.mockRestore();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("complete");
    expect(args.events.at(-1)).toEqual({ type: "done" });
    await saidLast(args.session.id, "Here is the answer.");
  });

  it.each([
    ["throws", (): ((event: SseEvent) => void) => () => { throw new Error("stream closed"); }],
    // The route's sink once the client has gone: every event after the first is dropped.
    ["is disconnected", (): ((event: SseEvent) => void) => {
      let open = true;
      return (event) => { if (open && event.type === "message_start") open = false; };
    }],
  ])("keeps running and saving when the sink %s", async (_label, makeSink) => {
    replies = [answer("Here is the answer.")];
    const args = await input();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runTurn({ ...args, sink: makeSink() });
    logged.mockRestore();
    expect(result.error).toBeUndefined();
    expect(result.aborted).toBeUndefined();
    expect(result.status).toBe("complete");
    expect(result.finalText).toBe("Here is the answer.");
    await saidLast(args.session.id, "Here is the answer.");
  });
});
