import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, defaultConfig, type ModelRef, type ThinkingLevel } from "@/lib/config/schema";
import { emptyDiagnostics } from "../reporting/diagnostics";
import type { JudgeInput } from "../scoring/judge";
import { RETAIL_EVAL_TASKS } from "../tasks";
import { BENCHMARK_VERSION, type EvalRunSummary, type OfflineAudit, type TaskEvalResult } from "../types";

const judged: JudgeInput[] = [];
const judgedAt: (ThinkingLevel | undefined)[] = [];

vi.mock("../scoring/judge", async (original) => ({
  ...(await original<typeof import("../scoring/judge")>()),
  evaluateWithJudge: vi.fn(async (input: JudgeInput, _config: AppConfig, _judge: ModelRef, thinking?: ThinkingLevel) => {
    judged.push(input);
    judgedAt.push(thinking);
    return {
      intentScore: 1, intentFeedback: "x", financialScore: 1, financialFeedback: "x", groundingScore: 1, groundingFeedback: "x",
      retailClarityScore: 1, retailClarityFeedback: "x", totalJudgeScore: 4, maxJudgeScore: 60, overallVerdict: "x",
      judgeModel: "p/judge", promptVersion: "7",
    };
  }),
}));

const { judgeRun } = await import("./rejudge");
const { judgeOnly, parseArgs } = await import("../cli");

const JUDGE = { provider: "p", model: "judge" };

/** A config that knows the saved runs' judge provider. */
function config(): AppConfig {
  const base = defaultConfig();
  base.llm.providers = [{ id: "p", type: "openai-compatible", name: "p", apiKey: "", baseUrl: "http://127.0.0.1:9999/v1", models: [] }];
  return base;
}

describe("threading the offline audit to the judge", () => {
  it("gives the judge the task's audit when a saved run is re-judged", async () => {
    const audit: OfflineAudit = {
      emptyProviderResults: 0, corpusNotCaptured: 0, notAvailableAsOf: 1, outOfScopeQueries: 0, integrityErrors: 0,
      events: [{ tool: "edgar_read_filing", kind: "not_available_as_of", normalizedRequest: { url: "https://www.sec.gov/x" }, urls: ["https://www.sec.gov/x"], reason: "future" }],
    };
    const result = {
      task: RETAIL_EVAL_TASKS[0], agent: "p/agent", repeat: 1, status: "judge_error", startedAt: "", endedAt: "", durationMs: 0,
      toolCalls: [], evidence: [], checks: [], figureMatches: [], finalAssistantText: "Answer.", sessionTickers: [], transcript: [],
      deterministicCheck: { version: BENCHMARK_VERSION, score: 10, maxScore: 20, details: [] },
      metrics: {
        unsourcedFigureRate: -1, unsourcedFigures: [], sourceTierMix: {}, conflictsDetected: 0, conflictsAddressed: 0, lookAheadEvidence: 0,
        evidenceEntries: 0, followUps: 0, blocks: 0, flags: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costUsd: 0, latencyMs: 0, modelCalls: 0,
      },
      diagnostics: emptyDiagnostics(),
      offlineAudit: audit,
    } as unknown as TaskEvalResult;
    const summary = { agents: ["p/agent"], judge: "p/judge", taskIds: [result.task.id], results: [result] } as unknown as EvalRunSummary;

    await judgeRun(summary, defaultConfig(), JUDGE);

    expect(judged[0]?.offlineAudit).toBe(audit);
  });
});

/** A result waiting for its judgement, as a run with a failed judge leaves it. */
function unjudged(agent: string, taskIndex: number, repeat: number): TaskEvalResult {
  return {
    task: RETAIL_EVAL_TASKS[taskIndex], agent, repeat, status: "judge_error", valid: false, startedAt: "", endedAt: "", durationMs: 0,
    toolCalls: [], evidence: [], checks: [], figureMatches: [], finalAssistantText: "Answer.", sessionTickers: [], transcript: [],
    deterministicCheck: { version: BENCHMARK_VERSION, score: 10, maxScore: 20, details: [] },
    metrics: {
      unsourcedFigureRate: -1, unsourcedFigures: [], sourceTierMix: {}, conflictsDetected: 0, conflictsAddressed: 0, lookAheadEvidence: 0,
      evidenceEntries: 0, followUps: 0, blocks: 0, flags: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costUsd: 0, latencyMs: 0, modelCalls: 0,
    },
    diagnostics: emptyDiagnostics(),
  } as unknown as TaskEvalResult;
}

/** Two agents, two tasks, two repeats, every judgement missing. */
function savedRun(): EvalRunSummary {
  const agents = ["p/agent", "local/Qwen/Qwen3-32B"];
  const results = agents.flatMap((agent) => [0, 1].flatMap((task) => [1, 2].map((repeat) => unjudged(agent, task, repeat))));
  return {
    timestamp: "2026-09-20T10:02:03.456Z", benchmarkVersion: BENCHMARK_VERSION, judgePromptVersion: "7", agents, judge: "p/judge",
    fixtureMode: "offline", policyMode: "enforce", configHash: "abc", repeat: 2,
    taskIds: [RETAIL_EVAL_TASKS[0].id, RETAIL_EVAL_TASKS[1].id],
    agentSummaries: agents.map((agent) => ({ agent, selfJudged: false })), results,
  } as unknown as EvalRunSummary;
}

describe("--judge-only", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "ofa-judge-only-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("summarises each task once per agent however many repeats and agents the run had", async () => {
    const rejudged = await judgeRun(savedRun(), defaultConfig(), JUDGE);
    expect(rejudged.agentSummaries.map((agent) => agent.agent)).toEqual(["p/agent", "local/Qwen/Qwen3-32B"]);
    for (const agent of rejudged.agentSummaries) {
      expect(agent.perTask.map((task) => task.taskId)).toEqual([RETAIL_EVAL_TASKS[0].id, RETAIL_EVAL_TASKS[1].id]);
      expect(agent.perTask.map((task) => task.runs)).toEqual([2, 2]);
    }
    expect(rejudged.results.every((result) => result.totalScore === 24)).toBe(true);
  });

  it("grades at the judge thinking the run recorded", async () => {
    const before = judgedAt.length;
    const rejudged = await judgeRun({ ...savedRun(), judgeThinking: "xhigh" }, defaultConfig(), JUDGE);
    expect(judgedAt.slice(before).every((thinking) => thinking === "xhigh")).toBe(true);
    expect(judgedAt.length).toBeGreaterThan(before);
    expect(rejudged.judgeThinking).toBe("xhigh");
    await judgeRun(savedRun(), defaultConfig(), JUDGE);
    expect(judgedAt.at(-1)).toBeUndefined();
  });

  it("leaves an infrastructure error unscored even when it kept draft text", async () => {
    const before = judged.length;
    const run = savedRun();
    const outage = { ...run.results[0], status: "infra_error" as const, finalAssistantText: "I could not complete a verified answer." };
    const rejudged = await judgeRun({ ...run, results: [outage] }, defaultConfig(), JUDGE);
    expect(rejudged.results[0]).toMatchObject({ status: "infra_error", valid: false });
    expect(rejudged.results[0].totalScore).toBeUndefined();
    expect(judged.length).toBe(before);
  });

  it("grades with the run's own judge, refusing another judge or one no longer configured", async () => {
    expect(parseArgs(["--judge-only", "run.json", "--judge", "p/other"])).toMatchObject({ ok: false });
    const before = judged.length;
    const outcome = await judgeOnly({ saved: savedRun(), config: defaultConfig(), outDir: dir, baselineDir: dir });
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("Unknown provider “p”") });
    expect(judged.length).toBe(before);
    const finished = await judgeOnly({ saved: savedRun(), config: config(), outDir: dir, baselineDir: dir });
    expect(finished.ok && finished.summary.judge).toBe("p/judge");
  });

  it("promotes the finished run with --baseline", async () => {
    const baselineDir = path.join(dir, "baselines");
    const outcome = await judgeOnly({ saved: savedRun(), config: config(), baseline: "finished", outDir: dir, baselineDir });
    expect(outcome.ok && outcome.baselinePath).toBe(path.join(baselineDir, "finished.json"));
    expect(existsSync(path.join(baselineDir, "finished.json"))).toBe(true);
  });

  it("refuses a run written before results recorded diagnostics, before judging", async () => {
    const before = judged.length;
    const old = savedRun();
    for (const result of old.results) delete (result as Partial<TaskEvalResult>).diagnostics;
    const outcome = await judgeOnly({ saved: old, config: config(), outDir: dir, baselineDir: dir });
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("before results recorded their diagnostics") });
    expect(judged.length).toBe(before);
  });

  it("refuses --baseline for a run that could never be one, before judging", async () => {
    const before = judged.length;
    const single = { ...savedRun(), repeat: 1 };
    const outcome = await judgeOnly({ saved: single, config: config(), baseline: "single", outDir: dir, baselineDir: dir });
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("needs --repeat 2 or more") });
    expect(judged.length).toBe(before);
  });
});
