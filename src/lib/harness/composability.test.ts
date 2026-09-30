import { describe, expect, it } from "vitest";
import { resolveContextBudget } from "@/lib/context/budget";
import type { FinanceTool } from "@/lib/tools/contracts";
import { RETAIL_EVAL_TASKS } from "../../../evals/tasks";
import { createToolSeam } from "../../../evals/harness/tool-seam";
import { sourceRequest, type SourceRequest } from "@/lib/data/source-snapshot";
import { assistant, fakeModel } from "@/lib/context/testing";
import { attachments } from "./attachments";
import { capabilities } from "./capabilities";
import { compaction } from "./compaction";
import type { Concern } from "./concern";
import { conduct } from "./conduct";
import { delivery } from "./delivery";
import { evidence } from "./evidence";
import { policy } from "./policy";
import { time } from "./time";
import { user } from "./user";
import { view } from "./view";
import { dataTool, generalTool, toolCall } from "@/lib/policy/testing";
import { Type } from "typebox";
import { answer, scriptedHarness, testRules, testTurn } from "./testing";
import { ledgerWith } from "@/lib/evidence/testing";

const budget = resolveContextBudget(fakeModel(32_768));
const names = ["time", "capabilities", "user", "attachments", "conduct", "evidence", "policy", "delivery", "compaction", "view", "telemetry"];

describe("concerns are independently removable", () => {
  it.each(names)("builds and completes a real Agent turn without %s", async (removed) => {
    const turn = testTurn({ ledger: ledgerWith() });
    const context = testRules(turn);
    const concerns: Concern[] = [time, capabilities(true), user(context), attachments("empty", fakeModel(32_768)), conduct, evidence,
      delivery, policy(context), compaction({ budget, summarize: async () => "checkpoint", onCompaction: () => {} }),
      view(budget), { name: "telemetry", wrapTool: (tool) => tool }];
    const h = scriptedHarness(concerns.filter((c) => c.name !== removed), turn);
    await h.run();
    expect(h.agent.state.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Done." }] });
    expect(h.seen).toHaveLength(1);
  });

  it("runs the smallest benchmark prompt through the offline tool seam with only evidence and view", async () => {
    const task = [...RETAIL_EVAL_TASKS].sort((a, b) => a.prompt.length - b.prompt.length)[0];
    expect(task.id).toBe("retail-14-apple-pre-open-timing");
    // The smallest turn that still exercises the seam: one tool call whose research starts from a
    // web search. Offline, the dataset answers it; the tool must never be asked to load live.
    const request: SourceRequest = { source: "tavily", operation: "search",
      args: { query: "Apple AAPL earnings report today October 31 2024", topic: "news", timeRange: "week", maxResults: 8 } };
    const calls = [{ tool: "web_search", args: { query: "Apple AAPL earnings report today October 31 2024", topic: "news" } }];
    const tools = calls.map((e): FinanceTool => {
      const base = generalTool(e.tool);
      return { ...base, execute: async (...args) => {
        await sourceRequest(request, async () => { throw new Error("offline must not load live"); });
        return base.execute(...args);
      } };
    });
    const wrapper = createToolSeam({ taskId: task.id, mode: "offline", asOf: task.asOfDate });
    const ledger = ledgerWith();
    const h = scriptedHarness([evidence, view(budget)], testTurn({ ledger, request: task.prompt }), [
      assistant({ calls: calls.map((e, i) => toolCall(`t${i}`, e.tool, e.args)) }),
      answer("The regular session has not opened. Distinguish pre-market trading from a completed closing price."),
    ], { tools: tools.filter(wrapper.keepTool).map(wrapper.wrapTool) as FinanceTool[], skillsIndex: [] });
    await h.run();
    await wrapper.close();
    expect(wrapper.stats()).toMatchObject({ hits: calls.length });
    expect(h.seen).toHaveLength(2);
    expect(h.agent.state.messages.filter((m) => m.role === "toolResult")).toHaveLength(calls.length);
    expect(ledger.list("E")).toHaveLength(calls.length);
    expect(h.agent.state.messages.at(-1)).toMatchObject({ stopReason: "stop" });
  });

  it("gives every tool one argument vocabulary at the capabilities boundary", async () => {
    const seen: unknown[] = [];
    const base = dataTool("edgar_filings", { id: "edgar", name: "SEC EDGAR", tier: 1, coverage: ["filings"] });
    const filings: FinanceTool = { ...base, parameters: Type.Object({ ticker: Type.String() }),
      execute: async (id, params, ...rest) => { seen.push(params); return base.execute(id, params, ...rest); } };
    const h = scriptedHarness([capabilities(true)], testTurn(), [
      assistant({ calls: [toolCall("f", "edgar_filings", { symbol: "NVDA" })] }), answer("Done."),
    ], { tools: [filings], skillsIndex: [] });
    await h.run();
    expect(seen).toEqual([{ ticker: "NVDA" }]);
    expect(h.agent.state.messages.find((m) => m.role === "toolResult")).toMatchObject({ isError: false });
  });
});
