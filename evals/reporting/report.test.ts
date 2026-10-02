import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  baselineRefusal,
  benchmarkValidityIssues,
  meanTaskSpread,
  renderSummaryMarkdown,
  scoreLine,
  SELF_JUDGED_LABEL,
  slug,
  suggestBaselineName,
  toBaseline,
  writeBaseline,
  writeRunFiles,
} from "./report";
import { mean, noiseTolerance, standardDeviation } from "./stats";
import { RETAIL_EVAL_TASKS } from "../tasks";
import { BENCHMARK_VERSION, type EvalRunSummary, type RunMetrics, type TaskEvalResult } from "../types";

const METRICS: RunMetrics = {
  unsourcedFigureRate: 0.25,
  unsourcedFigures: ["42.7%"],
  sourceTierMix: { tier1: 3, tier4: 1 },
  conflictsDetected: 1,
  conflictsAddressed: 1,
  lookAheadEvidence: 0,
  evidenceEntries: 4,
  followUps: 1,
  blocks: 2,
  flags: 0,
  tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
  costUsd: 0.0123,
  latencyMs: 4200,
  modelCalls: 3,
};

function result(): TaskEvalResult {
  return {
    task: RETAIL_EVAL_TASKS[0],
    agent: "local/Qwen/Qwen3-32B",
    repeat: 1,
    status: "completed",
    startedAt: "2026-09-20T10:00:00.000Z",
    endedAt: "2026-09-20T10:01:00.000Z",
    durationMs: 60_000,
    toolCalls: [
      { toolCallId: "call-1", toolName: "edgar_financials", args: {}, output: "x".repeat(50), durationMs: 10, isError: false },
    ],
    evidence: [{ id: "E1", kind: "E", summary: "EDGAR income", fetchedAt: "2026-09-20T10:00:30.000Z" }],
    checks: [],
    figureMatches: [],
    finalAssistantText: "NVIDIA guided margins lower.",
    sessionTickers: ["NVDA"],
    transcript: [],
    deterministicCheck: {
      version: BENCHMARK_VERSION,
      identifiedAllEntities: true,
      matchedEntities: ["NVIDIA"],
      missingEntities: [],
      derivedFigures: 1,
      mathExpectationSatisfied: true,
      citationCount: 2,
      figuresChecked: 4,
      figuresBacked: 3,
      evidenceAvailable: true,
      evidenceScore: 5,
      figureSupportScore: 5,
      contractScore: 8,
      contractResults: [],
      score: 18,
      maxScore: 20,
      details: ["[Entities: diagnostic] found [NVIDIA]"],
    },
    judgeResult: {
      intentScore: 14,
      intentFeedback: "Good",
      financialScore: 17,
      financialFeedback: "Good",
      groundingScore: 12,
      groundingFeedback: "Good",
      retailClarityScore: 9,
      retailClarityFeedback: "Good",
      totalJudgeScore: 52,
      maxJudgeScore: 60,
      overallVerdict: "Strong answer.",
      judgeModel: "openrouter/openai/gpt-5",
      promptVersion: "2",
    },
    integrityScore: 36,
    qualityScore: 52,
    totalScore: 88,
    metrics: METRICS,
    diagnostics: { toolArgumentErrors: 2, fallbackReports: 1, unverifiedFigures: 3, repairedFigures: 1 },
  };
}

function summary(): EvalRunSummary {
  return {
    timestamp: "2026-09-20T10:02:03.456Z",
    benchmarkVersion: BENCHMARK_VERSION,
    judgePromptVersion: "2",
    agents: ["local/Qwen/Qwen3-32B"],
    judge: "openrouter/openai/gpt-5",
    fixtureMode: "offline",
    policyMode: "enforce",
    configHash: "abc123",
    commit: "0123456789abcdef0123456789abcdef01234567",
    repeat: 1,
    taskIds: ["retail-01-nvda-beat-and-drop"],
    agentSummaries: [
      {
        agent: "local/Qwen/Qwen3-32B",
        selfJudged: false,
        completedTasks: 1,
        erroredTasks: 0,
        agentFailures: 0,
        infrastructureErrors: 0,
        invalidRuns: 0,
        completionRate: 1,
        qualityOnCompleted: 88,
        expectedUserScore: 88,
        averageIntegrityScore: 36,
        averageSemanticScore: 52,
        averageTotalScore: 88,
        maxPossibleScore: 100,
        perTask: [
          {
            taskId: "retail-01-nvda-beat-and-drop",
            title: "Earnings Beat & Drop Paradox (NVIDIA)",
            runs: 1,
            scores: [88],
            meanIntegrity: 36,
            meanQuality: 52,
            meanTotal: 88,
            sdTotal: 0,
            tolerance: 0,
          },
        ],
        metrics: METRICS,
        diagnostics: { toolArgumentErrors: 2, fallbackReports: 1, unverifiedFigures: 3, repairedFigures: 1 },
      },
    ],
    diagnostics: { toolArgumentErrors: 2, fallbackReports: 1, unverifiedFigures: 3, repairedFigures: 1 },
    results: [result()],
  };
}

let out: string;

beforeEach(() => {
  out = mkdtempSync(path.join(tmpdir(), "ofa-report-"));
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

describe("noise measurement", () => {
  it("computes the mean, the spread and a 2σ tolerance", () => {
    expect(mean([80, 90, 100])).toBe(90);
    expect(standardDeviation([90, 90, 90])).toBe(0);
    expect(standardDeviation([80, 100])).toBe(10);
    expect(noiseTolerance([80, 100])).toBe(20);
  });

  it("reports no spread for a single run", () => {
    expect(standardDeviation([90])).toBe(0);
  });
});

describe("run files", () => {
  it("writes the full run and a readable summary", () => {
    const files = writeRunFiles(summary(), out);
    expect(path.basename(files.jsonPath)).toBe("run-2026-09-20T10-02-03-456Z.json");
    expect(path.basename(files.mdPath)).toBe("summary-2026-09-20T10-02-03-456Z.md");

    const written = JSON.parse(readFileSync(files.jsonPath, "utf8")) as EvalRunSummary;
    expect(written.results[0].toolCalls).toHaveLength(1);
    expect(readFileSync(files.mdPath, "utf8")).toContain("Earnings Beat & Drop Paradox");
  });

  it("does not overwrite a run that has the same timestamp", () => {
    const first = writeRunFiles(summary(), out);
    const second = writeRunFiles(summary(), out);

    expect(second.jsonPath).not.toBe(first.jsonPath);
    expect(path.basename(second.jsonPath)).toBe(`run-2026-09-20T10-02-03-456Z-${process.pid}.json`);
    expect(readFileSync(first.jsonPath, "utf8")).toContain('"benchmarkVersion"');
    expect(readFileSync(second.jsonPath, "utf8")).toContain('"benchmarkVersion"');
  });

  it("puts the versions and the models in the summary", () => {
    const markdown = renderSummaryMarkdown(summary());
    expect(markdown).toContain(`**Benchmark version:** ${BENCHMARK_VERSION}`);
    expect(markdown).toContain("local/Qwen/Qwen3-32B");
  });

  it("prints the offline dataset's audit totals, and fails validity on an integrity error", () => {
    const dataset = { version: "mock-mcp-v5", taskHashes: { "retail-01-nvda-beat-and-drop": "h" }, corpusNotCaptured: 2, notAvailableAsOf: 1, emptyProviderResults: 3, outOfScopeQueries: 4, integrityErrors: 0 };
    const markdown = renderSummaryMarkdown({ ...summary(), dataset });
    expect(markdown).toContain("0 integrity errors · 2 corpus-not-captured · 3 empty results · 1 future-blocked · 4 out-of-scope");
    expect(markdown).not.toContain("live fallbacks");
    expect(benchmarkValidityIssues({ ...summary(), dataset: { ...dataset, integrityErrors: 1 } })).toContain("1 offline dataset integrity error(s)");
  });

  it("prints what the thinking level was sent as next to the level", () => {
    const report = { ...summary(), thinking: "high" as const, thinkingTransmitted: { "local/Qwen/Qwen3-32B": 'high → "xhigh"' } };
    expect(renderSummaryMarkdown(report)).toContain('- **Thinking:** high · **Sent:** `local/Qwen/Qwen3-32B` high → "xhigh"');
  });

  it("prints the judge's thinking and what it was sent as beside the agent's, only when the run set one", () => {
    const report = { ...summary(), thinking: "high" as const, judgeThinking: "max" as const, judgeThinkingTransmitted: { "p/judge": 'max → "max"' } };
    expect(renderSummaryMarkdown(report)).toContain('- **Judge thinking:** max · **Sent:** `p/judge` max → "max"');
    expect(renderSummaryMarkdown(summary())).not.toContain("Judge thinking");
  });

  it("marks a run whose agent and judge are the same model as self-judged and not baseline-eligible", () => {
    const selfJudged = summary();
    selfJudged.agentSummaries[0].selfJudged = true;
    const markdown = renderSummaryMarkdown(selfJudged);
    expect(markdown).toContain(`Expected user score: **88 / 100** — ${SELF_JUDGED_LABEL}`);
    expect(scoreLine(selfJudged.agentSummaries[0], 1)).toBe(`completion 100.0% · completed quality 88/100 · expected 88/100 · integrity 36/40 · semantic 52/60 (${SELF_JUDGED_LABEL})`);
    expect(renderSummaryMarkdown(summary())).not.toContain(SELF_JUDGED_LABEL);
  });

  it("prints per-task σ and the run's mean spread only when tasks were repeated", () => {
    const repeated = summary();
    repeated.repeat = 3;
    const agent = repeated.agentSummaries[0];
    agent.perTask = [
      { ...agent.perTask[0], runs: 3, scores: [80, 90, 100], sdTotal: 8.16, tolerance: 16.33 },
      { ...agent.perTask[0], taskId: "retail-02-nike-moat-erosion", title: "Nike", runs: 3, scores: [70, 70, 76], sdTotal: 2.83, tolerance: 5.66 },
      { ...agent.perTask[0], taskId: "retail-03-nuclear-thematic-purity", title: "Nuclear", runs: 1, scores: [60], sdTotal: 0, tolerance: 0 },
    ];
    expect(meanTaskSpread(agent)).toBe(5.5);
    const markdown = renderSummaryMarkdown(repeated);
    expect(markdown).toContain("- Spread: mean per-task σ **5.5** over 2 repeated task(s)");
    expect(markdown).toContain("| Task | Integrity | Semantic | Expected | σ |");
    expect(markdown).toContain("| 8.16 |");
    expect(scoreLine(agent, 3)).toBe("completion 100.0% · completed quality 88/100 · expected 88/100 · integrity 36/40 · semantic 52/60 · mean per-task σ 5.5");

    const single = renderSummaryMarkdown(summary());
    expect(single).not.toContain("Spread:");
    expect(single).not.toContain("| σ |");
    expect(meanTaskSpread(summary().agentSummaries[0])).toBeUndefined();
  });

  it("reports timeout checks as partial progress and infrastructure errors as unscored", () => {
    const report = summary();
    const timeout = result();
    timeout.status = "agent_timeout";
    timeout.deterministicCheck.score = 20;
    timeout.totalScore = 0;
    timeout.judgeResult = undefined;
    timeout.qualityScore = undefined;
    timeout.finalAssistantText = "partial extraction";
    timeout.error = "Agent turn exceeded the eval timeout";
    const infra = result();
    infra.status = "infra_error";
    infra.valid = false;
    infra.totalScore = undefined;
    infra.providerRetries = 2;
    infra.providerRetryErrors = ["503 upstream unavailable", "503 upstream unavailable"];
    infra.error = "503 upstream unavailable";
    report.results = [timeout, infra];
    report.agentSummaries[0].agentFailures = 1;
    report.agentSummaries[0].infrastructureErrors = 1;
    report.agentSummaries[0].erroredTasks = 2;

    const markdown = renderSummaryMarkdown(report);

    expect(markdown).toContain("partial progress; expected score remains zero");
    expect(markdown).toContain("Provider retries: 2");
    expect(markdown).toContain("Total: **unscored**");
    expect(markdown).toContain("infrastructure errors excluded: 1");
  });

  it("reports an exhausted budget as partial progress and the per-turn budget", () => {
    const report = summary();
    const spent = result();
    spent.status = "agent_budget";
    spent.totalScore = 0;
    spent.judgeResult = undefined;
    spent.qualityScore = undefined;
    spent.error = "The turn reached its model-call limit";
    report.results = [spent];

    const markdown = renderSummaryMarkdown(report);

    expect(markdown).toContain("Status: **agent_budget**");
    expect(markdown).toContain("partial progress; expected score remains zero");
    expect(markdown).toContain("Budget: 32 calls and 12m per turn");
    expect(markdown).not.toContain("Turn timeout");
  });

  it("prints the diagnostics for the run, each agent and each result", () => {
    const report = summary();
    const markdown = renderSummaryMarkdown(report);
    const line = "tool argument errors 2 · fallback reports 1 · unverified report figures 3 · repaired report figures 1";

    expect(markdown).toContain(`**Diagnostics:** ${line}`);
    expect(markdown.split(`- Diagnostics: ${line}`)).toHaveLength(3);
  });
});

describe("baselines", () => {
  it("drops the traces so the committed file stays small", () => {
    const baseline = toBaseline(summary());
    const record = baseline.results[0] as Record<string, unknown>;
    expect(record.toolCalls).toBeUndefined();
    expect(record.transcript).toBeUndefined();
    expect(record.evidence).toBeUndefined();
    expect(record.deterministicCheck).toBeDefined();
    expect(baseline.taskIds).toEqual(["retail-01-nvda-beat-and-drop"]);
  });

  it("writes a file named after the run and keeps slashes out of it", () => {
    const name = suggestBaselineName(summary());
    expect(name).toBe("2026-09-20-local-qwen-qwen3-32b-openrouter-openai-gpt-5");
    expect(slug("openrouter/openai/gpt-5")).toBe("openrouter-openai-gpt-5");

    const repeated = { ...summary(), repeat: 2 };
    const file = writeBaseline(repeated, name, out);
    expect(path.basename(file)).toBe(`${name}.json`);
    expect(JSON.parse(readFileSync(file, "utf8")).results[0].transcript).toBeUndefined();
  });

  it("refuses to promote a self-judged or single-repeat run, and says why", () => {
    expect(baselineRefusal({ repeat: 2, selfJudged: false })).toBeUndefined();
    expect(baselineRefusal({ repeat: 1, selfJudged: false })).toBe(
      "--baseline refuses this run: it has 1 repeat; a baseline needs --repeat 2 or more to measure its spread.",
    );
    expect(baselineRefusal({ repeat: 3, selfJudged: true })).toBe(
      "--baseline refuses this run: the judge is the same model as an agent (self-judged).",
    );

    expect(() => writeBaseline(summary(), "single", out)).toThrow("needs --repeat 2 or more");
    const selfJudged = { ...summary(), repeat: 2 };
    selfJudged.agentSummaries[0].selfJudged = true;
    expect(() => writeBaseline(selfJudged, "self", out)).toThrow("self-judged");
  });
});
