import { describe, expect, it } from "vitest";
import { summariseAgent } from "./summary";
import { RETAIL_EVAL_TASKS } from "../tasks";
import type { TaskEvalResult } from "../types";

const METRICS = {
  unsourcedFigureRate: -1, unsourcedFigures: [], sourceTierMix: {}, conflictsDetected: 0, conflictsAddressed: 0,
  lookAheadEvidence: 0, evidenceEntries: 0, followUps: 0, blocks: 0, flags: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costUsd: 0, latencyMs: 0, modelCalls: 0,
};

function cell(status: "completed" | "agent_timeout", total: number): TaskEvalResult {
  return {
    task: RETAIL_EVAL_TASKS[0], agent: "p/model", repeat: status === "completed" ? 1 : 2, status, valid: true, totalScore: total,
    finalAssistantText: status === "completed" ? "answer" : "", integrityScore: status === "completed" ? 30 : undefined,
    qualityScore: status === "completed" ? 50 : undefined,
    deterministicCheck: { score: 15 },
    ...(status === "completed" ? { judgeResult: { totalJudgeScore: 50, criticalMisses: [], criticalContradictions: [] } } : {}),
    metrics: METRICS, diagnostics: { toolArgumentErrors: 0, fallbackReports: 0, unverifiedFigures: 0, repairedFigures: 0 },
  } as unknown as TaskEvalResult;
}

describe("v2 score separation", () => {
  it("excludes timeouts from completed quality but counts them as zero expected score", () => {
    const summary = summariseAgent({ provider: "p", model: "model" }, { provider: "q", model: "judge" }, [RETAIL_EVAL_TASKS[0]], [cell("completed", 80), cell("agent_timeout", 0)]);
    expect(summary.completionRate).toBe(0.5);
    expect(summary.qualityOnCompleted).toBe(80);
    expect(summary.expectedUserScore).toBe(40);
  });
});
