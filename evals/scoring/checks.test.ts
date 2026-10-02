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
    expect(acquired.evidenceScore).toBe(6);
    expect(acquired.details.join("\n")).toContain("acquired only [NVDA quote]");

    const used = quoteRun("The prior close was $120.", [match("$120", 120, ["E1"])]);
    expect(used.evidenceScore).toBe(12);
    expect(used.figureSupportScore).toBe(12);
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
      sessionTickers: [], evidence: [entry("E1"), entry("C1", "C", { value: 2, unit: "%", inputs: ["E1"] })], figureMatches: [match("2%", 2, ["C1"])], evidenceAvailable: true,
    });
    expect(visible.mathExpectationSatisfied).toBe(false);
    expect(visible.contractScore).toBe(0);
  });

  it("verifies the target arithmetic, exact filing, lineage and final display", () => {
    const source = NVDA.contracts[0];
    if (source.kind !== "verified_calculation" || source.target.kind !== "filing_guidance_growth") throw new Error("missing NVDA calculation contract");
    const e = entry("E1", "E", {
      tool: "edgar_read_filing", source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
      args: { url: source.target.url },
      numbers: [{ value: 30_000_000_000, unit: "USD", context: "Revenue $30.0 billion" },
        { value: 32_500_000_000, unit: "USD", context: "Guidance $32.5 billion" }],
    });
    const c = entry("C1", "C", { value: 8.189081, unit: "%", inputs: ["E1"] });
    const base = {
      task: NVDA, toolCalls: [call("edgar_read_filing", { url: source.target.url }, { url: source.target.url, evidence: { id: "E1" } })],
      finalText: "Guided sequential growth is 8.19%.", sessionTickers: [], evidence: [e, c],
      figureMatches: [match("8.19%", 8.19, ["C1"])], evidenceAvailable: true,
    };
    expect(runDeterministicChecks(base).contractScore).toBe(16);
    expect(runDeterministicChecks({ ...base, evidence: [e, { ...c, value: 15 }] }).contractScore).toBe(0);
    expect(runDeterministicChecks({ ...base, evidence: [{ ...e, args: { url: "https://sec.gov/wrong" } }, c] }).contractScore).toBe(0);
    expect(runDeterministicChecks({ ...base, evidence: [e, { ...c, inputs: ["E99"] }] }).contractScore).toBe(0);
    expect(runDeterministicChecks({ ...base, figureMatches: [] }).contractScore).toBe(0);
  });

  it("does not credit a correct number from the wrong subject or fiscal period", () => {
    const task = RETAIL_EVAL_TASKS.find((item) => item.id === "retail-02-nike-moat-erosion");
    if (!task) throw new Error("missing Nike moat task");
    const fiscalFacts = (ticker: string, priorPeriod: string): EvidenceEntry => entry("E1", "E", {
      tool: "edgar_financials", entity: { ticker }, source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
      facts: [{ metric: "revenue", period: "2024-03-31", periodType: "annual", value: 120, unit: "USD" },
        { metric: "revenue", period: priorPeriod, periodType: "annual", value: 100, unit: "USD" }],
    });
    const c = entry("C1", "C", { value: 20, unit: "%", inputs: ["E1"] });
    const base = { task, toolCalls: [], finalText: "Growth was 20%.", sessionTickers: [],
      evidence: [fiscalFacts("DECK", "2023-03-31"), c], figureMatches: [match("20%", 20, ["C1"])], evidenceAvailable: true };
    expect(runDeterministicChecks(base).contractScore).toBe(16);
    expect(runDeterministicChecks({ ...base, evidence: [fiscalFacts("NKE", "2023-03-31"), c] }).contractScore).toBe(0);
    expect(runDeterministicChecks({ ...base, evidence: [fiscalFacts("DECK", "2022-03-31"), c] }).contractScore).toBe(0);
    expect(runDeterministicChecks({ ...base, evidence: [{ ...fiscalFacts("DECK", "2023-03-31"),
      facts: fiscalFacts("DECK", "2023-03-31").facts?.map((fact) => ({ ...fact, periodType: "quarterly" as const })) }, c] }).contractScore).toBe(0);
  });

  it("credits cited qualitative SMCI filings without demanding an eight-word quotation", () => {
    const task = RETAIL_EVAL_TASKS.find((item) => item.id === "retail-10-smci-accounting-red-flag");
    if (!task) throw new Error("missing SMCI task");
    const requirements = task.requiredEvidence.filter((item) => item.kind === "source");
    if (requirements.length !== 2) throw new Error("missing SMCI sources");
    const urls = requirements.map((item) => item.urls[0]);
    const calls = urls.map((url, index) => call("edgar_read_filing", { url }, { url, evidence: { id: `E${index + 1}` } }));
    const evidence = urls.map((url, index) => entry(`E${index + 1}`, "E", { tool: "edgar_read_filing", args: { url } }));
    const result = runDeterministicChecks({ task, toolCalls: calls,
      finalText: "EY's resignation raises an audit-confidence risk [E1], while Nasdaq flagged the late 10-K [E2]. That does not prove fraud.",
      sessionTickers: [], evidence, figureMatches: [], evidenceAvailable: true });
    expect(result.contractScore).toBe(16);
    // The separate 12-point evidence-use check stays conservative for non-numeric paraphrases.
    expect(result.evidenceScore).toBe(6);
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

  it("requires the named filings, not an arbitrary successful tool call", () => {
    const task = RETAIL_EVAL_TASKS.find((item) => item.id === "retail-06-mstr-proxy-leverage");
    if (!task) throw new Error("missing MSTR task");
    const unrelated = runDeterministicChecks({ task, toolCalls: [call("financial_calculator", { expression: "1+1" })],
      finalText: "The result is 2.", sessionTickers: [], evidence: [entry("C1", "C", { value: 2, unit: "USD" })],
      figureMatches: [match("2", 2, ["C1"])], evidenceAvailable: true });
    expect(unrelated.contractScore).toBe(0);
    const required = task.requiredEvidence.filter((item) => item.kind === "source");
    if (required.length < 2) throw new Error("missing MSTR source requirements");
    const urls = required.slice(0, 2).map((item) => item.urls[0]);
    const calls = urls.map((url, index) => call("edgar_read_filing", { url }, { url, evidence: { id: `E${index + 1}` } }));
    const evidence = urls.map((url, index) => entry(`E${index + 1}`, "E", { tool: "edgar_read_filing", args: { url } }));
    const used = runDeterministicChecks({ task, toolCalls: calls, finalText: "The filings show 331,200 BTC [E1] and $2.6B notes [E2].",
      sessionTickers: [], evidence, figureMatches: [match("331,200", 331200, ["E1"]), match("$2.6B", 2_600_000_000, ["E2"])], evidenceAvailable: true });
    expect(used.contractScore).toBe(16);
    const finalTerms = runDeterministicChecks({ task, toolCalls: [calls[0]],
      finalText: "The November 25 filing reports the holdings and final $3.0B note terms [E1].",
      sessionTickers: [], evidence: [evidence[0]],
      figureMatches: [match("$3.0B", 3_000_000_000, ["E1"])], evidenceAvailable: true });
    expect(finalTerms.contractScore).toBe(16);
    expect(runDeterministicChecks({ task, toolCalls: calls, finalText: "Both figures came from filings.",
      sessionTickers: [], evidence, figureMatches: [match("331,200", 331200, ["E1"]), match("$2.6B", 2_600_000_000, ["E2"])], evidenceAvailable: true }).contractScore).toBe(0);
  });

  it("scores the cross-turn evidence outcome rather than a particular recovery tool, and requires a dated Apple quote", () => {
    const cross = RETAIL_EVAL_TASKS.find((item) => item.id === "retail-13-semis-figure-survival");
    const apple = RETAIL_EVAL_TASKS.find((item) => item.id === "retail-14-apple-pre-open-timing");
    if (!cross || !apple) throw new Error("missing cross-turn or Apple task");
    const facts = [
      entry("E1", "E", { tool: "edgar_financials", entity: { ticker: "AMD" }, source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
        facts: [{ metric: "revenue", period: "2024-09-28", value: 6819, unit: "USD" }] }),
      entry("E2", "E", { tool: "edgar_financials", entity: { ticker: "INTC" }, source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
        facts: [{ metric: "grossMargin", period: "2024-09-28", value: 15, unit: "%" }] }),
    ];
    const crossBase = { task: cross,
      toolCalls: [call("edgar_financials", { ticker: "AMD" }, { statement: "key_metrics", evidence: { id: "E1" } }),
        call("edgar_financials", { ticker: "INTC" }, { statement: "key_metrics", evidence: { id: "E2" } })],
      finalText: "AMD revenue was 6819 and Intel margin was 15%.", sessionTickers: [], evidence: facts,
      figureMatches: [match("6819", 6819, ["E1"]), match("15%", 15, ["E2"])], evidenceAvailable: true };
    expect(runDeterministicChecks(crossBase).contractScore).toBe(16);
    const wrongRead = call("evidence_get", { id: "E99" }, { id: "E99", from: "facts" });
    expect(runDeterministicChecks({ ...crossBase, toolCalls: [...crossBase.toolCalls, wrongRead] }).contractScore).toBe(16);
    const reads = ["E1", "E2"].map((id) => call("evidence_get", { id }, { id, from: "facts" }));
    expect(runDeterministicChecks({ ...crossBase, toolCalls: [...crossBase.toolCalls, ...reads] }).contractScore).toBe(16);
    expect(runDeterministicChecks({ ...crossBase, figureMatches: [match("6819", 6819, ["E1"])] }).contractScore).toBe(0);
    const marginInputs = entry("E2", "E", { tool: "edgar_financials", entity: { ticker: "INTC" },
      source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
      facts: [
        { metric: "grossProfit", period: "2024-09-28", value: 1_997, unit: "USD" },
        { metric: "revenue", period: "2024-09-28", value: 13_284, unit: "USD" },
      ] });
    const margin = entry("C1", "C", { unit: "%", inputs: ["E2"], table: { columns: ["label", "value"], rows: [["2024-09-28", 15.0331]] } });
    expect(runDeterministicChecks({ ...crossBase, evidence: [facts[0], marginInputs, margin],
      figureMatches: [match("6819", 6819, ["E1"]), match("15.0331%", 15.0331, ["C1"])] }).contractScore).toBe(16);

    const quote = (period: string) => entry("E1", "E", { tool: "market_quotes", entity: { ticker: "AAPL" },
      facts: [{ metric: "close", period, value: 230, unit: "USD" }] });
    const appleBase = { task: apple, toolCalls: [call("market_quotes", { symbols: ["AAPL"] }, { evidence: { id: "E1" } })],
      finalText: "The previous close was $230.", sessionTickers: [], evidence: [quote("2024-10-30")],
      figureMatches: [match("$230", 230, ["E1"])], evidenceAvailable: true };
    expect(runDeterministicChecks(appleBase).contractScore).toBe(16);
    expect(runDeterministicChecks({ ...appleBase, evidence: [quote("2024-10-31")] }).contractScore).toBe(8);
  });

  it("keeps task contracts valid and within the 16-point budget", () => {
    for (const task of RETAIL_EVAL_TASKS) {
      expect(task.contracts.reduce((sum, contract) => sum + contract.points, 0), task.id).toBe(16);
      for (const contract of task.contracts) {
        if (contract.kind !== "required_evidence_used" && contract.kind !== "required_evidence_cited") continue;
        for (const label of contract.requirementLabels) {
          expect(task.requiredEvidence.some((item) => item.label === label), `${task.id}: ${label}`).toBe(true);
        }
      }
    }
  });

  it("scores figure precision as the exact ratio instead of rounding to full", () => {
    const matches = Array.from({ length: 139 }, (_, index) => match(String(index + 1), index + 1, index < 127 ? ["E1"] : []));
    const result = quoteRun("Figures are in the attached analysis.", matches);
    expect(result.figuresBacked).toBe(127);
    expect(result.figuresChecked).toBe(139);
    expect(result.figureSupportScore).toBe(11);
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
    expect(result.figureSupportScore).toBe(3.6);
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
    expect(runDeterministicChecks({ ...base, fallbackReports: 0 }).contractScore).toBe(16);
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
    expect(result.maxScore).toBe(40);
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
