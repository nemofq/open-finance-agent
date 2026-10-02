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
