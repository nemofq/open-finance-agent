import { describe, expect, it } from "vitest";
import { rescoreRun } from "./rescore";
import { RETAIL_EVAL_TASKS } from "../tasks";
import type { EvalRunSummary, TaskEvalResult } from "../types";

describe("saved-run rescoring", () => {
  it("upgrades a trace-bearing v1 timeout without judging it or overwriting the input", () => {
    const task = RETAIL_EVAL_TASKS[0];
    const result = {
      task: { ...task, contracts: undefined }, agent: "p/model", repeat: 1,
      status: "agent_timeout", valid: true, totalScore: 0, finalAssistantText: "", sessionTickers: [],
      toolCalls: [], evidence: [], checks: [], figureMatches: [], transcript: [],
      deterministicCheck: { evidenceAvailable: false },
      diagnostics: { toolArgumentErrors: 0, fallbackReports: 0, unverifiedFigures: 0, repairedFigures: 0 },
      metrics: { unsourcedFigureRate: -1, unsourcedFigures: [], sourceTierMix: {}, conflictsDetected: 0, conflictsAddressed: 0, lookAheadEvidence: 0, evidenceEntries: 0, followUps: 0, blocks: 0, flags: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costUsd: 0, latencyMs: 0, modelCalls: 0 },
    } as unknown as TaskEvalResult;
    const saved = {
      timestamp: "2024-01-01T00:00:00Z", benchmarkVersion: "1", judgePromptVersion: "7", agents: ["p/model"], judge: "q/judge",
      fixtureMode: "offline", policyMode: "enforce", configHash: "x", repeat: 1, taskIds: [task.id], results: [result],
      agentSummaries: [], diagnostics: result.diagnostics,
    } as unknown as EvalRunSummary;

    const rescored = rescoreRun(saved);
    expect(rescored.benchmarkVersion).toBe("2");
    expect(rescored.results[0].deterministicCheck.maxScore).toBe(40);
    expect(rescored.results[0].totalScore).toBe(0);
    expect(rescored.results[0].judgeResult).toBeUndefined();
    expect(saved.benchmarkVersion).toBe("1");
  });

  it("reuses the recorded 13/60 judge verdict and computes integrity directly out of 40", () => {
    const task = RETAIL_EVAL_TASKS[0];
    const result = {
      task, agent: "p/model", repeat: 1, status: "completed", valid: true,
      finalAssistantText: "NVIDIA answer", sessionTickers: [],
      toolCalls: [], evidence: [], checks: [], figureMatches: [], transcript: [],
      deterministicCheck: { evidenceAvailable: false, score: 40, maxScore: 40 },
      judgeResult: {
        intentScore: 5, intentFeedback: "", financialScore: 2, financialFeedback: "",
        groundingScore: 4, groundingFeedback: "", retailClarityScore: 2, retailClarityFeedback: "",
        totalJudgeScore: 13, maxJudgeScore: 60, overallVerdict: "", judgeModel: "q/judge", promptVersion: "7",
      },
      totalScore: 53,
      diagnostics: { toolArgumentErrors: 0, fallbackReports: 0, unverifiedFigures: 0, repairedFigures: 0 },
      metrics: { unsourcedFigureRate: -1, unsourcedFigures: [], sourceTierMix: {}, conflictsDetected: 0, conflictsAddressed: 0, lookAheadEvidence: 0, evidenceEntries: 0, followUps: 0, blocks: 0, flags: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costUsd: 0, latencyMs: 0, modelCalls: 0 },
    } as unknown as TaskEvalResult;
    const saved = {
      timestamp: "2024-01-01T00:00:00Z", benchmarkVersion: "1", judgePromptVersion: "7",
      agents: ["p/model"], judge: "q/judge", fixtureMode: "offline", policyMode: "enforce",
      configHash: "x", repeat: 1, taskIds: [task.id], results: [result], agentSummaries: [],
      diagnostics: result.diagnostics,
    } as unknown as EvalRunSummary;

    const rescored = rescoreRun(saved);
    expect(rescored.results[0]).toMatchObject({ integrityScore: 0, qualityScore: 13, totalScore: 13 });
    expect(rescored.agentSummaries[0]).toMatchObject({ completionRate: 1, qualityOnCompleted: 13, expectedUserScore: 13 });
    expect(saved.results[0].judgeResult?.totalJudgeScore).toBe(13);
    expect(saved.results[0].totalScore).toBe(53);
  });

  it("refuses a baseline file whose trace fields were stripped", () => {
    const saved = { benchmarkVersion: "1", judgePromptVersion: "7", results: [{ task: RETAIL_EVAL_TASKS[0], agent: "p/model" }] } as unknown as EvalRunSummary;
    expect(() => rescoreRun(saved)).toThrow("saved result has no toolCalls trace");
  });

  it("keeps a budget stop without an answer at expected score zero", () => {
    const task = RETAIL_EVAL_TASKS[0];
    const result = {
      task, agent: "p/model", repeat: 1, status: "agent_budget", valid: true, finalAssistantText: "", sessionTickers: [],
      toolCalls: [], evidence: [], checks: [], figureMatches: [], transcript: [], stop: { reason: "model_call_limit" },
      deterministicCheck: { evidenceAvailable: false },
      diagnostics: { toolArgumentErrors: 0, fallbackReports: 0, unverifiedFigures: 0, repairedFigures: 0 },
      metrics: { unsourcedFigureRate: -1, unsourcedFigures: [], sourceTierMix: {}, conflictsDetected: 0, conflictsAddressed: 0, lookAheadEvidence: 0, evidenceEntries: 0, followUps: 0, blocks: 0, flags: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costUsd: 0, latencyMs: 0, modelCalls: 0 },
    } as unknown as TaskEvalResult;
    const saved = {
      timestamp: "2024-01-01T00:00:00Z", benchmarkVersion: "1", judgePromptVersion: "7", agents: ["p/model"], judge: "q/judge",
      fixtureMode: "offline", policyMode: "enforce", configHash: "x", repeat: 1, taskIds: [task.id], results: [result],
      agentSummaries: [], diagnostics: result.diagnostics,
    } as unknown as EvalRunSummary;

    const rescored = rescoreRun(saved);
    expect(rescored.results[0]).toMatchObject({ status: "agent_budget", totalScore: 0 });
    expect(rescored.results[0].judgeResult).toBeUndefined();
  });
});
