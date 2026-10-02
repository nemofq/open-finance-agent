import { describe, expect, it } from "vitest";
import { compareRuns } from "./compare";
import { RETAIL_EVAL_TASKS } from "../tasks";
import type { EvalRunSummary, TaskEvalResult } from "../types";

function cell(agent: string, taskIndex: number, repeat: number, totalScore: number, options: { completed?: boolean; contradiction?: boolean } = {}): TaskEvalResult {
  const completed = options.completed ?? true;
  return {
    agent, task: RETAIL_EVAL_TASKS[taskIndex], repeat, totalScore, valid: true,
    status: completed ? "completed" : "agent_timeout",
    finalAssistantText: completed ? "answer" : "",
    ...(completed ? { judgeResult: { error: undefined, criticalContradictions: options.contradiction ? ["critical"] : [] } } : {}),
  } as unknown as TaskEvalResult;
}

function run(version: string, agent: string, scores: number[], options: { completed?: boolean[]; contradictions?: boolean[] } = {}): EvalRunSummary {
  const taskIds = [RETAIL_EVAL_TASKS[0].id, RETAIL_EVAL_TASKS[1].id];
  return {
    benchmarkVersion: version, judgePromptVersion: "8", agents: [agent], repeat: 3, taskIds,
    results: scores.map((score, index) => cell(agent, Math.floor(index / 3), index % 3 + 1, score, {
      completed: options.completed?.[index], contradiction: options.contradictions?.[index],
    })),
  } as unknown as EvalRunSummary;
}

describe("paired v2 comparison", () => {
  it("reports paired delta, bootstrap bound and win/tie/loss", () => {
    const baseline = run("2", "old/model", [80, 80, 80, 70, 70, 70]);
    const candidate = run("2", "new/model", [82, 80, 81, 71, 70, 72]);
    const result = compareRuns(candidate, baseline).comparisons[0];
    expect(result.meanDelta).toBe(1);
    expect(result.wins).toBe(4);
    expect(result.ties).toBe(2);
    expect(result.losses).toBe(0);
    expect(result.lower95).toBeGreaterThanOrEqual(0);
    expect(result.passed).toBe(true);
  });

  it("blocks a task drop, completion regression and new repeated critical contradiction", () => {
    const baseline = run("2", "old/model", [80, 80, 80, 70, 70, 70]);
    const candidate = run("2", "new/model", [70, 70, 70, 70, 70, 70], {
      completed: [true, true, true, false, true, true],
      contradictions: [true, true, false, false, false, false],
    });
    const result = compareRuns(candidate, baseline).comparisons[0];
    expect(result.passed).toBe(false);
    expect(result.blockers.join("\n")).toContain("completion fell");
    expect(result.blockers.join("\n")).toContain("critical contradiction");
    expect(result.blockers.join("\n")).toContain("fell 10 points");
  });

  it("refuses to compare v1 and v2", () => {
    expect(() => compareRuns(run("2", "new/model", [1, 1, 1, 1, 1, 1]), run("1", "old/model", [1, 1, 1, 1, 1, 1])))
      .toThrow("Cannot compare benchmark v2 with v1");
  });

  it("refuses to compare interim v2 scores made with the old judge rubric", () => {
    const current = run("2", "new/model", [80, 80, 80, 70, 70, 70]);
    const interim = { ...run("2", "old/model", [80, 80, 80, 70, 70, 70]), judgePromptVersion: "7" };
    expect(() => compareRuns(current, interim)).toThrow("Cannot compare judge prompt v8 with v7");
  });
});
