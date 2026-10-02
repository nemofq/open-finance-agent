import type { AppConfig, ModelRef } from "@/lib/config/schema";
import { modelRefKey } from "@/lib/llm/catalog";
import { evaluateWithJudge, JUDGE_PROMPT_VERSION } from "../scoring/judge";
import { parseModelSpec } from "../models";
import { round } from "../reporting/stats";
import { sumDiagnostics, summariseAgent } from "../reporting/summary";
import { budgetExhausted } from "./turn-bounds";
import type { EvalRunSummary, EvalTask, JudgeEvaluationResult, TaskEvalResult } from "../types";

/** Each task once, in the run's order, from the results that ran it. */
function runTasks(summary: EvalRunSummary): EvalTask[] {
  return summary.taskIds.flatMap((id) => {
    const task = summary.results.find((result) => result.task.id === id)?.task;
    return task ? [task] : [];
  });
}

/**
 * A result the judge grades: an answer the agent finished, or stopped on its budget with, whose
 * judgement is missing or failed. Agent failures, infrastructure errors and harness errors stay
 * unscored by the judge.
 */
export function awaitsJudgement(result: TaskEvalResult): boolean {
  if (!result.finalAssistantText.trim()) return false;
  if (result.status === "judge_error") return true;
  return (result.status === "completed" || result.status === "agent_budget") && !result.judgeResult;
}

/** Record a judgement on a result: a failed judge leaves it unscored, a verdict scores it. */
export function applyJudgement(result: TaskEvalResult, judgeResult: JudgeEvaluationResult): void {
  result.judgeResult = judgeResult;
  if (judgeResult.error) {
    result.status = "judge_error";
    result.valid = false;
    result.invalidReason = `Judge failed: ${judgeResult.error}`;
    delete result.qualityScore;
    delete result.integrityScore;
    delete result.totalScore;
  } else {
    if (judgeResult.maxJudgeScore !== 60 || judgeResult.totalJudgeScore < 0 || judgeResult.totalJudgeScore > 60) {
      throw new Error(`Expected a valid 60-point judge result, got ${judgeResult.totalJudgeScore}/${judgeResult.maxJudgeScore}.`);
    }
    if (result.deterministicCheck.maxScore !== 20 || result.deterministicCheck.version !== "2") {
      throw new Error(`Cannot combine a v${result.deterministicCheck.version ?? "unknown"} integrity score with v2 quality; use --rescore on a trace-bearing run.`);
    }
    result.status = budgetExhausted(result.stop) ? "agent_budget" : "completed";
    result.valid = true;
    delete result.invalidReason;
    result.qualityScore = round(judgeResult.totalJudgeScore, 2);
    result.integrityScore = round(result.deterministicCheck.score * 2, 2);
    result.totalScore = round(result.integrityScore + result.qualityScore, 2);
  }
}

/**
 * Finish grading a persisted run without spending another agent turn. Only missing/failed judges
 * run, at the judge thinking the run recorded, so every result was graded the same way.
 */
export async function judgeRun(
  summary: EvalRunSummary,
  config: AppConfig,
  judge: ModelRef,
): Promise<EvalRunSummary> {
  const agents = summary.agents.map((spec) => {
    const agent = parseModelSpec(spec);
    if (!agent) throw new Error(`The saved run names an agent "${spec}" that is not a provider/model spec.`);
    return agent;
  });
  for (const result of summary.results) {
    if (awaitsJudgement(result)) applyJudgement(result, await evaluateWithJudge(result, config, judge, summary.judgeThinking));
  }
  return {
    ...summary,
    judge: modelRefKey(judge),
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    diagnostics: sumDiagnostics(summary.results),
    agentSummaries: agents.map((agent) => summariseAgent(agent, judge, runTasks(summary), summary.results)),
  };
}
