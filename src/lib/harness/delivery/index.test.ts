import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { normalizeContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { stubBefore } from "@/lib/context/stubs";
import { createLedger } from "@/lib/evidence/ledger";
import { delivery } from ".";
import { resolveDelivery, looksLikeAnalysis } from "./resolve";
import type { ToolCall, ToolOutcome } from "../concern";
import { summarizeChecks } from "@/lib/policy/summary";
import { publishReport } from "@/lib/reports/publish";
import { answer, scriptedHarness, testTurn } from "../testing";
import { assistant } from "@/lib/context/testing";
import { generalTool, toolCall } from "@/lib/policy/testing";
import { ledgerWith } from "@/lib/evidence/testing";

const skill = { name: "earnings-preview", output: "earnings-preview" };
const table = "| Quarter | $MSFT | $GOOGL |\n|---|---|---|\n| 2024-09-30 | 16.0% | 15.1% |\n| 2024-12-31 | 12.3% | 11.8% |";
const many = "Revenue rose 16.0% then 12.3%, with margins of 74.6%, 73.1%, 71.8% and 70.2% against guidance of 69.5% and consensus of 68.4%.";
const call: ToolCall = { name: "create_report", id: "r1", args: { spec: {} } };
const result = (isError: boolean): ToolOutcome => ({ content: [{ type: "text", text: isError ? "Rejected: missing src" : "Created" }], details: undefined, isError });
const start = (overrides: Parameters<typeof testTurn>[0] = {}) => {
  const turn = testTurn(overrides);
  delivery.beforeTurn!(turn, []);
  return turn;
};

describe("delivery", () => {
  it("withholds future values from reference-correction guidance", () => {
    const turn = start();
    const future = turn.ledger.add({ kind: "E", summary: "Future margin", value: 91.23, unit: "%", lookAhead: true });
    const text = `The margin is {${future.id}}.`;
    expect(delivery.beforeRunEnd!(text, turn)).toMatchObject({ rule: "delivery",
      text: expect.stringContaining("was not available at the turn cutoff") });
    expect(JSON.stringify(delivery.beforeRunEnd!(text, turn))).not.toContain("91.23");
  });

  it("leaves reference syntax inside code examples alone", () => {
    const turn = start({ request: "Quickly explain the reference syntax." });
    expect(delivery.beforeRunEnd!("Use `{E7:revenue:FY24}` or ``{C3}``.\n```text\n{C4}\n```\n~~~text\n{C5}\n~~~", turn)).toBeUndefined();
    expect(delivery.beforeRunEnd!("Separate fragments {C`example`3} do not form a reference.", turn)).toBeUndefined();
    expect(delivery.beforeRunEnd!("Use `{C3}` for syntax; the margin is {E99}.", turn)).toMatchObject({ rule: "delivery",
      text: expect.stringContaining("E99 is not in the evidence ledger") });
  });

  it("resolves its own placeholders in the final answer instead of asking the model", async () => {
    const h = scriptedHarness([delivery], testTurn({ request: "What was revenue?" }), [answer("Revenue was {E1}; see `{E1}` for syntax.")]);
    const revenue = h.turn.ledger.add({ kind: "E", summary: "Revenue", value: 12.5, unit: "%" });
    await h.run();
    expect(h.turn.checks).toEqual([]);
    await h.composed.afterTurn(h.agent.state.messages);
    const accepted = h.composed.answer.accepted!.content[0];
    expect(accepted).toMatchObject({ type: "text", text: expect.stringMatching(/^Revenue was 12\.5\s?% \[E1\]; see `\{E1\}` for syntax\.$/) });
    expect(h.agent.state.messages.at(-1)).toBe(h.composed.answer.accepted);
    expect(h.turn.checks).toEqual([expect.objectContaining({ rule: "delivery", kind: "annotate", reason: "Evidence placeholders resolved by the harness", evidence: [revenue.id] })]);
  });

  it("still follows up on a placeholder the ledger cannot resolve", async () => {
    const turn = start();
    turn.ledger.add({ kind: "E", summary: "Revenue", value: 12.5, unit: "%" });
    expect(delivery.beforeRunEnd!("Revenue was {E1}.", turn)).toBeUndefined();
    expect(delivery.beforeRunEnd!("Revenue was {E1} and margin {E9}.", turn)).toMatchObject({ rule: "delivery",
      text: expect.stringContaining("E9 is not in the evidence ledger") });
    const messages = [{ role: "user" as const, content: turn.request, timestamp: 0 }, answer("Margin {E9}.")];
    await delivery.afterTurn!(messages, turn);
    expect(messages[1]).toMatchObject({ content: [{ text: "Margin {E9}." }] });
    expect(turn.checks).toEqual([]);
  });

  it("keeps the report tool available after a refused attempt, and closes tools once one is created", () => {
    const turn = start({ skill });
    delivery.toolResult!(call, result(true), turn);
    expect(turn.delivery).toMatchObject({ mode: "report", stage: "pending" });
    expect(delivery.beforeTool!(call, turn)).toBeUndefined();
    expect(delivery.beforeRunEnd!("This is research, not investment advice.", turn)).toMatchObject({ rule: "delivery" });
    delivery.toolResult!(call, result(false), turn);
    expect(turn.delivery?.stage).toBe("created");
    expect(delivery.beforeTool!({ ...call, name: "web_search" }, turn)).toMatchObject({ block: true });
    expect(delivery.beforeRunEnd!(table, turn)).toBeUndefined();
    const note = delivery.turnNote!(turn)!;
    expect(note).toContain("The report is final and no tool is available this turn");
    expect(note).toMatch(/Verification notes in prose, never recompute it or send it again/);
    expect(note.split(/(?<=\.)\s+/)).toHaveLength(2);
  });

  it("commits an automatic turn to a report as soon as the model attempts one", () => {
    const turn = start();
    delivery.toolResult!(call, result(true), turn);
    expect(turn.delivery).toMatchObject({ mode: "report", stage: "pending", why: "The agent started a report." });
  });

  it("renders the answer as the report when a promised report never arrived", async () => {
    const turn = start({ skill, ledger: ledgerWith(), request: "Write up the quarter." });
    const user = { role: "user" as const, content: turn.request, timestamp: 0 };
    const text = `# Nike after the print\n\nRevenue fell 2% [E1].\n\n## Detail\n\n${table}\n\n- Margins held\n- Guidance cut`;
    const messages: AgentMessage[] = [user, answer(text)];
    await delivery.afterTurn!(messages, turn);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    const call = messages[1];
    const created = messages[2];
    expect(call.role === "assistant" && call.content[0]).toMatchObject({ type: "toolCall", name: "create_report",
      arguments: { title: "Nike after the print", sections: [
        { heading: "Summary", blocks: [{ type: "text", text: "Revenue fell 2% [E1]." }] },
        { heading: "Detail", blocks: [{ type: "table", columns: ["Quarter", "$MSFT", "$GOOGL"] }, { type: "list", items: ["Margins held", "Guidance cut"] }] },
        // The promised template's sections arrive either way, each saying it is not covered.
        ...["Setup", "Expectations", "What matters this quarter", "Scenarios", "Risks", "Stance"].map((heading) =>
          ({ heading, blocks: [{ type: "text", text: "Not covered in this report." }] })),
      ] } });
    expect(created.role === "toolResult" && created.details).toMatchObject({ title: "Nike after the print", format: "doc", rendered: "answer" });
    expect(created.role === "toolResult" && String((created.details as { html: string }).html)).toContain("Verification notes");
    expect(turn.delivery).toMatchObject({ stage: "created", why: expect.stringContaining("Rendered from the chat answer") });
    expect(turn.checks).toEqual([expect.objectContaining({ rule: "delivery", kind: "flag", reason: expect.stringContaining("Report rendered from the chat answer") })]);
  });

  it("keeps a report rendered from the answer in the ledger a reloaded chat rebuilds", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "ofa-delivery-"));
    try {
      const turn = start({ skill, ledger: createLedger({ sessionId: "s1", dataDir }), request: "Write up the quarter." });
      const messages: AgentMessage[] = [{ role: "user", content: turn.request, timestamp: 0 }, answer(`# Nike after the print\n\n${table}`)];
      await delivery.afterTurn!(messages, turn);
      const call = messages[1];
      const id = call.role === "assistant" && call.content[0].type === "toolCall" ? call.content[0].id : undefined;
      expect(id).toBeDefined();
      expect(turn.ledger.get("R1")?.toolCallId).toBe(id);
      // The harness's report is stubbed to its id in later turns, like one the model created.
      const later = stubBefore(messages, messages.length, turn.ledger)[1];
      expect(later.role === "assistant" && later.content[0]).toMatchObject({ type: "toolCall", arguments: { spec: "<R1 stub>" } });

      const reloaded = createLedger({ sessionId: "s1", dataDir, messages });
      expect(reloaded.get("R1")).toMatchObject({ kind: "R", tool: "create_report", toolCallId: id });
      const next = await publishReport({ title: "Next", sections: [{ heading: "Notes", blocks: [{ type: "text", text: "More." }] }] },
        reloaded, { defaultFormat: "doc" });
      expect(next.evidence.id).toBe("R2");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it.each(["chat", "created", "quick fact"])("leaves the transcript alone at turn end: %s", async (scenario) => {
    const turn = start({ ledger: ledgerWith(), request: scenario === "chat" ? "Give a quick answer in chat." : "Compare the businesses." });
    if (scenario === "created") turn.delivery!.stage = "created";
    const messages = [{ role: "user" as const, content: turn.request, timestamp: 0 }, answer(scenario === "quick fact" ? "Revenue was $30,040M [E7]." : many)];
    await delivery.afterTurn!(messages, turn);
    expect(messages).toHaveLength(2);
    expect(turn.checks).toHaveLength(0);
  });

  it.each(["explicit chat", "prior turn", "tool result", "recovery", "reports unavailable"])("keeps %s outside automatic report commitment", async (scenario) => {
    const turn = start({ request: scenario === "explicit chat" ? "Give a quick answer in chat." : "Compare the businesses." });
    turn.final = scenario === "recovery";
    turn.availableTools = scenario === "reports unavailable" ? [] : undefined;
    const user = { role: "user" as const, content: turn.request, timestamp: 0 };
    const messages = scenario === "prior turn" ? [user, answer(many), { ...user, timestamp: 1 }]
      : scenario === "tool result" ? [user, { role: "toolResult" as const, toolCallId: "source", toolName: "source",
        content: [{ type: "text" as const, text: many }], isError: false, timestamp: 1 }]
      : [user, answer(many)];
    expect(await delivery.transformContext!(messages, turn)).toBe(messages);
    expect(delivery.beforeRunEnd!("The requested facts are available.", turn)).toBeUndefined();
  });

  it.each([skill, { name: "valuation", output: "  valuation  " }])("honours the template of $name even with a chat opt-out", (skill) => {
    const turn = start({ skill, request: "briefly, no report" });
    expect(turn.delivery).toMatchObject({ mode: "report", template: skill.output.trim() });
    expect(delivery.beforeRunEnd!("Here is the preview.", turn)).toMatchObject({ rule: "delivery", text: expect.stringContaining(`template ${skill.output.trim()}`) });
    expect(turn.checks).toHaveLength(0);
  });

  it.each([undefined, { name: "screener" }, { name: "screener", output: " " }])("leaves quick facts in chat without a promised template: %s", (skill) => {
    const turn = start({ skill });
    expect(delivery.turnNote!(turn)).toBeDefined();
    expect(delivery.beforeRunEnd!("Revenue was $30,040M [E7], up 122.4% [C3].", turn)).toBeUndefined();
  });

  it.each([table, many, `${"Alphabet accelerated while Microsoft held its band. ".repeat(60)} 16.0%, 12.3%, 11.8%.`])("moves substantive chat answers into a report", (text) => {
    expect(looksLikeAnalysis(text)).toBeDefined();
    expect(delivery.beforeRunEnd!(text, start())).toMatchObject({ text: expect.stringContaining("do not write it out again in chat") });
  });

  it.each(["in chat please", "in the chat", "no report", "without a report", "just tell me", "briefly", "quick answer", "quick reply", "quick version", "quick summary", "quick take", "quickly", "short answer", "one-liner", "one liner", "tldr", "tl;dr", "don't make a report", "dont build a report", "don't create a report"])("keeps a plain turn in chat for %s", (request) => {
    expect(delivery.beforeRunEnd!(table, start({ request }))).toBeUndefined();
  });

  it.each(["write a briefing", "what does the report say about chatter?"])("matches opt-outs only at word boundaries: %s", (request) => {
    expect(resolveDelivery({ request }).why).not.toContain("The user asked");
    expect(delivery.beforeRunEnd!(table, start({ request }))).toBeDefined();
  });

  it.each(["Quick check: what was revenue?", "What were revenue and margin? Just those two numbers, with sources.", "Only the 3 values, please."])("keeps a bounded factual request in chat despite extra figures: %s", (request) => {
    const turn = start({ request });
    expect(turn.delivery?.mode).toBe("chat");
    expect(delivery.beforeRunEnd!(many, turn)).toBeUndefined();
    expect(delivery.beforeTool!(call, turn)).toMatchObject({ block: true });
  });

  it("does not treat a research constraint as a bounded answer request", () => {
    const turn = start({ request: "Compare the businesses using only those two figures from the filings." });
    expect(turn.delivery?.mode).toBe("auto");
    expect(delivery.beforeRunEnd!(many, turn)).toMatchObject({ rule: "delivery" });
  });

  it("does not infer a pending plain-turn report from gathered source counts", async () => {
    const turn = start();
    for (let i = 0; i < 5; i++) delivery.toolResult!({ ...call, name: "web_search" }, result(false), turn);
    expect(delivery.turnNote!(turn)).toBeDefined();
    expect(delivery.beforeRunEnd!(table, turn)).toBeDefined();
  });

  it("uses the shared correction budget, flags after it is spent, and appears in the footer", async () => {
    const harness = scriptedHarness([delivery], testTurn({ skill }), Array.from({ length: 4 }, () => answer("Preview.")));
    await harness.run();
    expect(harness.turn.checks.map((c) => c.kind)).toEqual(["follow_up", "follow_up", "follow_up", "flag"]);
    expect(harness.turn.followUpsLeft).toBe(0);
    expect(summarizeChecks(harness.turn.checks, harness.turn.ledger.list()).followUps).toBe(3);
  });

  it("records an observed correction without sending it to the model", async () => {
    const h = scriptedHarness([delivery], testTurn({ skill, mode: "observe" }));
    await h.run();
    expect(h.seen).toHaveLength(1);
    expect(h.turn.checks[0]).toMatchObject({ rule: "delivery", kind: "follow_up", enforced: false });
  });

  it("ends tool use after success, while chat retains the other tools", () => {
    const tools = [{ name: "create_report", description: "report", parameters: {} }, { name: "lookup", description: "lookup", parameters: {} }];
    const turn = start({ skill });
    expect(delivery.tools!(tools, turn).map((t) => t.name)).toEqual(["create_report", "lookup"]);
    turn.delivery!.stage = "created";
    expect(delivery.tools!(tools, turn)).toEqual([]);
    expect(delivery.tools!(tools, start({ request: "no report" })).map((t) => t.name)).toEqual(["lookup"]);
  });

  it("does not execute a queued lookup after the report has been created", async () => {
    let lookups = 0;
    const report = { ...generalTool("create_report"), executionMode: "sequential" as const };
    const lookup = { ...generalTool("lookup"), execute: async () => { lookups += 1; return result(false); } };
    const h = scriptedHarness([delivery], testTurn(), [
      assistant({ calls: [toolCall("report", "create_report", {}), toolCall("late", "lookup", {})] }),
      answer("The verified conclusion."),
    ], { tools: [report, lookup], skillsIndex: [] });
    await h.run();
    expect(h.turn.delivery?.stage).toBe("created");
    expect(lookups).toBe(0);
    expect(h.seen[1].tools).toEqual([]);
    h.turn.request = "Quick check: what was the revenue?";
    await h.composed.beforeTurn(h.agent.state.messages);
    expect(h.composed.requestContext(normalizeContext({ messages: [] })).tools?.map((tool) => tool.name)).toEqual(["lookup"]);
  });
});
