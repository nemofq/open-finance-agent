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
  toBaseline,
  writeBaseline,
  writeRunFiles,
} from "./report";
import { RETAIL_EVAL_TASKS } from "../tasks";
import { BENCHMARK_VERSION, type EvalRunSummary, type RunMetrics, type TaskEvalResult } from "../types";

const METRICS: RunMetrics = {
  unsourcedFigureRate: 0.25, unsourcedFigures: ["42.7%"], sourceTierMix: { tier1: 3 },
  conflictsDetected: 1, conflictsAddressed: 1, lookAheadEvidence: 0, evidenceEntries: 4,
  followUps: 1, blocks: 2, flags: 0,
  tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
  costUsd: 0.0123, latencyMs: 4200, modelCalls: 3,
};
const DIAGNOSTICS = { toolArgumentErrors: 2, fallbackReports: 1, unverifiedFigures: 3, repairedFigures: 1 };

function result(): TaskEvalResult {
  return {
    task: RETAIL_EVAL_TASKS[0], agent: "local/model", repeat: 1, status: "completed",
    startedAt: "2026-09-20T10:00:00.000Z", endedAt: "2026-09-20T10:01:00.000Z", durationMs: 60_000,
    toolCalls: [], evidence: [], checks: [], figureMatches: [], finalAssistantText: "Forward margins disappointed.", sessionTickers: ["NVDA"], transcript: [],
    deterministicCheck: {
      version: BENCHMARK_VERSION, identifiedAllEntities: true, matchedEntities: ["NVIDIA"], missingEntities: [], derivedFigures: 1,
      mathExpectationSatisfied: true, citationCount: 2, figuresChecked: 4, figuresBacked: 3, evidenceAvailable: true,
      evidenceScore: 5, figureSupportScore: 5, contractScore: 8, contractResults: [], score: 18, maxScore: 20, details: ["ok"],
    },
    judgeResult: {
      rubricItems: [], dimensionScores: { intent: 18, financial: 25, grounding: 17, clarity: 10 },
      intentScore: 18, intentFeedback: "Good", financialScore: 25, financialFeedback: "Good",
      groundingScore: 17, groundingFeedback: "Good", retailClarityScore: 10, retailClarityFeedback: "Good",
      totalJudgeScore: 70, maxJudgeScore: 80, criticalMisses: [], criticalContradictions: [],
      overallVerdict: "Strong", judgeModel: "p/judge", promptVersion: "8",
    },
    qualityScore: 70, integrityScore: 18, totalScore: 88, valid: true, metrics: METRICS, diagnostics: DIAGNOSTICS,
  };
}

function summary(): EvalRunSummary {
  return {
    timestamp: "2026-09-20T10:02:03.456Z", benchmarkVersion: BENCHMARK_VERSION, judgePromptVersion: "8",
    agents: ["local/model"], judge: "p/judge", judgeRepeat: 3, fixtureMode: "offline", policyMode: "enforce",
    calibration: { anchors: 36, repeats: 3, orderingAccuracy: 1, weightedKappa: 0.9, scoreMae: 3, maxScoreStdDev: 2, passed: true },
    configHash: "abc", repeat: 3, taskIds: [RETAIL_EVAL_TASKS[0].id],
    agentSummaries: [{
      agent: "local/model", selfJudged: false, completedTasks: 3, erroredTasks: 0, agentFailures: 0, infrastructureErrors: 0, invalidRuns: 0,
      completionRate: 1, qualityOnCompleted: 88, expectedUserScore: 88, averageIntegrityScore: 18, averageSemanticScore: 70,
      averageTotalScore: 88, criticalMissRate: 0, criticalContradictionRate: 0, maxPossibleScore: 100,
      perTask: [{ taskId: RETAIL_EVAL_TASKS[0].id, title: RETAIL_EVAL_TASKS[0].title, runs: 3, scores: [88, 88, 88], meanIntegrity: 18, meanQuality: 70, meanTotal: 88, sdTotal: 0, tolerance: 0 }],
      metrics: METRICS, diagnostics: DIAGNOSTICS,
    }],
    diagnostics: DIAGNOSTICS, results: [result()],
  };
}

let out: string;
beforeEach(() => { out = mkdtempSync(path.join(tmpdir(), "ofa-report-")); });
afterEach(() => { rmSync(out, { recursive: true, force: true }); });

describe("v2 reports", () => {
  it("shows completion, conditional quality and expected score separately", () => {
    const report = summary();
    expect(scoreLine(report.agentSummaries[0], 3)).toContain("completion 100.0% · completed quality 88/100 · expected 88/100");
    const markdown = renderSummaryMarkdown(report);
    expect(markdown).toContain("Integrity: 18 / 20");
    expect(markdown).toContain("Semantic: 70 / 80");
  });

  it("shows timeout quality as N/A-like partial progress while expected score is zero", () => {
    const report = summary();
    const timedOut = result();
    timedOut.status = "agent_timeout";
    timedOut.totalScore = 0;
    timedOut.judgeResult = undefined;
    report.results = [timedOut];
    const markdown = renderSummaryMarkdown(report);
    expect(markdown).toContain("expected user score remains zero without a judgeable answer");
    expect(markdown).toContain("model execution did not reach a judgeable final answer");
  });

  it("writes fresh run files and strips traces from baselines", () => {
    const files = writeRunFiles(summary(), out);
    expect(readFileSync(files.mdPath, "utf8")).toContain("Expected user score");
    expect((toBaseline(summary()).results[0] as Record<string, unknown>).toolCalls).toBeUndefined();
    expect(JSON.parse(readFileSync(files.jsonPath, "utf8")).benchmarkVersion).toBe("2");
    expect(path.basename(files.jsonPath)).toBe("run-2026-09-20T10-02-03-456Z.json");
    expect(path.basename(files.mdPath)).toBe("summary-2026-09-20T10-02-03-456Z.md");

    const written = JSON.parse(readFileSync(files.jsonPath, "utf8")) as EvalRunSummary;
    expect(written.results[0].toolCalls).toHaveLength(0);
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
    expect(markdown).toContain("local/model");
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
    expect(scoreLine(selfJudged.agentSummaries[0], 1)).toBe(`completion 100.0% · completed quality 88/100 · expected 88/100 · integrity 18/20 · semantic 70/80 (${SELF_JUDGED_LABEL})`);
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
    expect(scoreLine(agent, 3)).toBe("completion 100.0% · completed quality 88/100 · expected 88/100 · integrity 18/20 · semantic 70/80 · mean per-task σ 5.5");

    const singleRun = summary();
    singleRun.repeat = 1;
    singleRun.agentSummaries[0].perTask[0].runs = 1;
    const single = renderSummaryMarkdown(singleRun);
    expect(single).not.toContain("Spread:");
    expect(single).not.toContain("| σ |");
    expect(meanTaskSpread(singleRun.agentSummaries[0])).toBeUndefined();
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

    expect(markdown).toContain("partial progress; expected user score remains zero");
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
    expect(markdown).toContain("partial progress; expected user score remains zero");
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

describe("baseline eligibility", () => {
  it("requires repeat=3 and judge-repeat=3 and rejects self judging", () => {
    expect(baselineRefusal({ repeat: 3, judgeRepeat: 3, selfJudged: false })).toBeUndefined();
    expect(baselineRefusal({ repeat: 2, judgeRepeat: 3, selfJudged: false })).toContain("--repeat 3");
    expect(baselineRefusal({ repeat: 3, judgeRepeat: 1, selfJudged: false })).toContain("--judge-repeat 3");
    expect(baselineRefusal({ repeat: 3, judgeRepeat: 3, selfJudged: true })).toContain("self-judged");
  });

  it("writes only eligible v2 baselines", () => {
    const file = writeBaseline(summary(), "v2-test", out);
    expect(path.basename(file)).toBe("v2-test.json");
    const invalid = summary();
    invalid.judgeRepeat = 1;
    expect(() => writeBaseline(invalid, "bad", out)).toThrow("judge repeat");
    expect(benchmarkValidityIssues(invalid, { baseline: true }).join(" ")).toContain("judge repeat");
    const legacy = { ...summary(), benchmarkVersion: "1" };
    expect(() => writeBaseline(legacy, "legacy", out)).toThrow("requires benchmark v2");
  });
});
