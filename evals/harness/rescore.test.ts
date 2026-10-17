import { describe, expect, it } from "vitest";
import { defaultConfig } from "@/lib/config/schema";
import { rescoreRun } from "./rescore";
import { RETAIL_EVAL_TASKS } from "../tasks";
import type { EvalRunSummary, TaskEvalResult } from "../types";

describe("saved-run rescoring", () => {
  it("upgrades a trace-bearing v1 timeout without judging it or overwriting the input", async () => {
    const task = RETAIL_EVAL_TASKS[0];
    const result = {
      task: { ...task, rubricItems: undefined, contracts: undefined }, agent: "p/model", repeat: 1,
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

    const rescored = await rescoreRun(saved, defaultConfig(), { provider: "q", model: "judge" }, 1);
    expect(rescored.benchmarkVersion).toBe("2");
    expect(rescored.results[0].deterministicCheck.maxScore).toBe(40);
    expect(rescored.results[0].totalScore).toBe(0);
    expect(rescored.results[0].judgeResult).toBeUndefined();
    expect(saved.benchmarkVersion).toBe("1");
  });

  it("refuses a baseline file whose trace fields were stripped", async () => {
    const saved = { benchmarkVersion: "1", results: [{ task: RETAIL_EVAL_TASKS[0], agent: "p/model" }] } as unknown as EvalRunSummary;
    await expect(rescoreRun(saved, defaultConfig(), { provider: "q", model: "judge" }, 1)).rejects.toThrow("saved result has no toolCalls trace");
  });

  it("keeps a budget stop without an answer at expected score zero", async () => {
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

    const rescored = await rescoreRun(saved, defaultConfig(), { provider: "q", model: "judge" }, 1);
    expect(rescored.results[0]).toMatchObject({ status: "agent_budget", totalScore: 0 });
    expect(rescored.results[0].judgeResult).toBeUndefined();
  });
});

describe("rescoring some tasks", () => {
  const [nvda, nike] = RETAIL_EVAL_TASKS;
  const metrics = { unsourcedFigureRate: -1, unsourcedFigures: [], sourceTierMix: {}, conflictsDetected: 0, conflictsAddressed: 0, lookAheadEvidence: 0, evidenceEntries: 0, followUps: 0, blocks: 0, flags: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costUsd: 0, latencyMs: 0, modelCalls: 0 };
  const diagnostics = { toolArgumentErrors: 0, fallbackReports: 0, unverifiedFigures: 0, repairedFigures: 0 };
  const traces = { toolCalls: [], evidence: [], checks: [], figureMatches: [], transcript: [] };
  // A judged answer on one task, and a timeout on another that rescoring settles without a judge.
  const graded = { task: nike, agent: "p/model", repeat: 1, status: "completed", valid: true, finalAssistantText: "An answer.", sessionTickers: [],
    deterministicCheck: { version: "2", maxScore: 40, score: 30, evidenceAvailable: true }, judgeResult: { totalJudgeScore: 40, promptVersion: "9" },
    integrityScore: 30, qualityScore: 40, totalScore: 70, diagnostics, metrics } as unknown as TaskEvalResult;
  const timedOut = { task: nvda, agent: "p/model", repeat: 1, status: "agent_timeout", valid: true, totalScore: 0, finalAssistantText: "", sessionTickers: [],
    deterministicCheck: { evidenceAvailable: false }, diagnostics, metrics } as unknown as TaskEvalResult;
  const baseline = (results: TaskEvalResult[]) => ({
    timestamp: "2024-01-01T00:00:00Z", benchmarkVersion: "2", judgePromptVersion: "9", agents: ["p/model"], judge: "q/judge", judgeRepeat: 3,
    fixtureMode: "offline", policyMode: "enforce", configHash: "x", repeat: 1, taskIds: [nvda.id, nike.id], results, agentSummaries: [], diagnostics,
  }) as unknown as EvalRunSummary;
  const judge = { provider: "q", model: "judge" };

  it("rescores only the named tasks and leaves every other result exactly as saved", async () => {
    const saved = baseline([{ ...timedOut, ...traces }, graded]);
    const rescored = await rescoreRun(saved, defaultConfig(), judge, 3, { taskIds: [nvda.id] });
    expect(rescored.results[0].deterministicCheck.maxScore).toBe(40);
    expect(rescored.results[1]).toEqual(graded);
  });

  it("takes the rescored tasks' traces from the run a baseline came from", async () => {
    const run = baseline([{ ...timedOut, ...traces }]);
    const rescored = await rescoreRun(baseline([timedOut, graded]), defaultConfig(), judge, 3, { taskIds: [nvda.id], traces: run });
    expect(rescored.results[0].toolCalls).toEqual([]);
    expect(rescored.results[0].deterministicCheck.maxScore).toBe(40);
  });

  it("refuses traces whose answer differs from the one being rescored", async () => {
    const run = baseline([{ ...timedOut, ...traces, finalAssistantText: "A different answer." }]);
    await expect(rescoreRun(baseline([timedOut, graded]), defaultConfig(), judge, 3, { taskIds: [nvda.id], traces: run }))
      .rejects.toThrow("differs from the one being rescored");
  });

  it("refuses to rescore some tasks of an older benchmark version, or at a different judge repeat", async () => {
    await expect(rescoreRun({ ...baseline([graded]), benchmarkVersion: "1" }, defaultConfig(), judge, 3, { taskIds: [nike.id] }))
      .rejects.toThrow("needs a benchmark v2 run");
    await expect(rescoreRun(baseline([graded]), defaultConfig(), judge, 1, { taskIds: [nike.id] }))
      .rejects.toThrow("same --judge-repeat");
  });
});
