import { describe, expect, it } from "vitest";
import type { EvidenceEntry, FigureMatch } from "@/lib/evidence/types";
import { analyseEvidence } from "./evidence";
import { runDeterministicChecks } from "./checks";
import { RETAIL_EVAL_TASKS } from "../tasks";
import type { EvalTask, ToolCallTrace } from "../types";

const NVDA = RETAIL_EVAL_TASKS[0];
const QUOTE_TASK: EvalTask = {
  ...NVDA,
  requiredEvidence: [{ kind: "ledger", source: "quote", ticker: "NVDA", label: "NVDA quote", points: 15 }],
};

function call(toolName: string, args: Record<string, unknown> = {}, details?: unknown): ToolCallTrace {
  return { toolCallId: `call-${toolName}`, toolName, args, output: "served", durationMs: 1, isError: false, offlineOutcome: "served", ...(details ? { details } : {}) };
}

function entry(id: string, kind: EvidenceEntry["kind"] = "E", options: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return { id, kind, summary: id, fetchedAt: "2024-01-01T00:00:00Z", ...options };
}

function match(raw: string, value: number, ids: string[]): FigureMatch {
  return { figure: { raw, value, index: 0 }, matches: ids };
}

function quoteRun(finalText: string, figureMatches: FigureMatch[], evidence: EvidenceEntry[] = [entry("E1")]) {
  return runDeterministicChecks({
    task: QUOTE_TASK,
    toolCalls: [call("market_quotes", { symbols: ["NVDA"] }, { evidence: { id: "E1" } })],
    finalText,
    sessionTickers: [],
    evidence,
    figureMatches,
    evidenceAvailable: true,
  });
}

describe("v2 deterministic integrity", () => {
  it("keeps entities diagnostic-only and gives acquisition half of evidence credit", () => {
    const acquired = quoteRun("The stock moved.", []);
    expect(acquired.identifiedAllEntities).toBe(true);
    expect(acquired.evidenceScore).toBe(3);
    expect(acquired.details.join("\n")).toContain("acquired only [NVDA quote]");

    const used = quoteRun("The prior close was $120.", [match("$120", 120, ["E1"])]);
    expect(used.evidenceScore).toBe(6);
    expect(used.figureSupportScore).toBe(6);
  });

  it("does not award a calculation contract merely because calculator was called", () => {
    const irrelevant = runDeterministicChecks({
      task: NVDA,
      toolCalls: [call("financial_calculator", { expression: "1+1" })],
      finalText: "NVDA beat estimates.",
      sessionTickers: [], evidence: [entry("C1", "C", { value: 2 })], figureMatches: [], evidenceAvailable: true,
    });
    expect(irrelevant.mathExpectationSatisfied).toBe(false);
    expect(irrelevant.contractScore).toBe(0);

    const visible = runDeterministicChecks({
      task: NVDA,
      toolCalls: [call("financial_calculator", { expression: "1+1" })],
      finalText: "The computed change is 2%.",
      sessionTickers: [], evidence: [entry("E1"), entry("C1", "C", { value: 2, inputs: ["E1"] })], figureMatches: [match("2%", 2, ["C1"])], evidenceAvailable: true,
    });
    expect(visible.mathExpectationSatisfied).toBe(true);
    expect(visible.contractScore).toBe(8);
  });

  it("requires calculation lineage, a non-empty tool result and acquired evidence for contracts", () => {
    const noLineage = runDeterministicChecks({
      task: NVDA, toolCalls: [call("financial_calculator")], finalText: "The computed change is 2%.", sessionTickers: [],
      evidence: [entry("C1", "C", { value: 2 })], figureMatches: [match("2%", 2, ["C1"])], evidenceAvailable: true,
    });
    expect(noLineage.contractScore).toBe(0);

    const apple = RETAIL_EVAL_TASKS.find((task) => task.id === "retail-14-apple-pre-open-timing");
    if (!apple) throw new Error("missing Apple timing task");
    const emptyQuote = call("market_quotes", { symbols: ["AAPL"] }, { empty: true });
    emptyQuote.offlineOutcome = "empty";
    const empty = runDeterministicChecks({ task: apple, toolCalls: [emptyQuote], finalText: "Apple reports later.", sessionTickers: [], evidence: [], figureMatches: [], evidenceAvailable: true });
    expect(empty.contractScore).toBe(0);
  });

  it("scores figure precision as the exact ratio instead of rounding to full", () => {
    const matches = Array.from({ length: 139 }, (_, index) => match(String(index + 1), index + 1, index < 127 ? ["E1"] : []));
    const result = quoteRun("Figures are in the attached analysis.", matches);
    expect(result.figuresBacked).toBe(127);
    expect(result.figuresChecked).toBe(139);
    expect(result.figureSupportScore).toBe(5.5);
  });

  it("does not count repaired report citations as model-supported figures", () => {
    const report = call("create_report", {
      spec: { title: "Report", sections: [{ heading: "Results", blocks: [{ type: "text", text: "Revenue was 10." }] }] },
    }, { verification: { checked: 10, supported: 3, repaired: 5, unverified: 2, byKind: { values: 2, sources: 0, references: 0, structure: 0 } } });
    report.offlineOutcome = undefined;
    const result = runDeterministicChecks({
      task: QUOTE_TASK, toolCalls: [call("market_quotes", { symbols: ["NVDA"] }, { evidence: { id: "E1" } }), report],
      finalText: "Report delivered.", sessionTickers: [], evidence: [entry("E1")], figureMatches: [], evidenceAvailable: true,
    });
    expect(result.figuresChecked).toBe(10);
    expect(result.figuresBacked).toBe(3);
    expect(result.figureSupportScore).toBe(1.8);
    expect(result.details.join("\n")).toContain("5 citation(s) repaired");
  });

  it("does not let a fallback report satisfy the delivery contract", () => {
    const task = RETAIL_EVAL_TASKS.find((item) => item.id === "retail-11-nike-earnings-review-report");
    if (!task) throw new Error("missing report task");
    const spec = {
      title: "Nike", template: "earnings-review",
      sections: ["Results vs expectations", "Guidance", "Drivers", "Reaction", "Stance"].map((heading) => ({ heading, blocks: [{ type: "text", text: "Analysis." }] })),
    };
    const report = call("create_report", { spec });
    report.offlineOutcome = undefined;
    const base = { task, toolCalls: [report], finalText: "I created the report.", sessionTickers: [], evidence: [], figureMatches: [], evidenceAvailable: true };
    expect(runDeterministicChecks({ ...base, fallbackReports: 0 }).contractScore).toBe(8);
    expect(runDeterministicChecks({ ...base, fallbackReports: 1 }).contractScore).toBe(0);
    const missingSection = { ...report, args: { spec: { ...spec, sections: spec.sections.slice(0, 4) } } };
    expect(runDeterministicChecks({ ...base, toolCalls: [missingSection], fallbackReports: 0 }).contractScore).toBe(0);
    const rejected = { ...report, isError: true };
    expect(runDeterministicChecks({ ...base, toolCalls: [rejected], fallbackReports: 0 }).contractScore).toBe(0);
    expect(runDeterministicChecks({ ...base, toolCalls: [], finalText: JSON.stringify({ tool: "create_report", arguments: { spec } }), fallbackReports: 0 }).contractScore).toBe(0);
  });

  it("returns zero with an explicit contract record for an empty answer", () => {
    const result = runDeterministicChecks({ task: NVDA, toolCalls: [], finalText: "", sessionTickers: [], evidence: [], figureMatches: [], evidenceAvailable: false });
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(20);
    expect(result.contractResults).toHaveLength(NVDA.contracts.length);
  });
});

describe("ledger reconstruction", () => {
  it("matches answer figures to registered evidence", async () => {
    const evidence = entry("E1", "E", { facts: [{ metric: "revenue", period: "FY25 Q2", value: 30_040, unit: "USD" }] });
    const analysis = await analyseEvidence({
      sessionId: "1ac74a0c-0000-4000-8000-000000000000", dataDir: "/tmp/not-used",
      messages: [{ role: "toolResult", toolCallId: "c1", toolName: "edgar_financials", content: [{ type: "text", text: "Revenue $30,040M" }], isError: false, timestamp: 0, details: { evidence } }],
      reported: [evidence], finalText: "Revenue reached $30,040M.",
    });
    expect(analysis.available).toBe(true);
    expect(analysis.figureMatches.some((item) => item.matches.includes("E1"))).toBe(true);
  });

  it("treats a user-provided figure as sourced through a U entry", async () => {
    const filing = entry("E1");
    const analysis = await analyseEvidence({
      sessionId: "1ac74a0c-0000-4000-8000-000000000000", dataDir: "/tmp/not-used",
      messages: [
        { role: "user", content: [{ type: "text", text: "It fell 53.4%." }], timestamp: 0 },
        { role: "toolResult", toolCallId: "c1", toolName: "edgar_read_filing", content: [{ type: "text", text: "Filing" }], isError: false, timestamp: 1, details: { evidence: filing } },
      ],
      reported: [filing], finalText: "You mention the 53.4% fall.",
    });
    expect(analysis.entries.some((item) => item.kind === "U")).toBe(true);
  });
});
