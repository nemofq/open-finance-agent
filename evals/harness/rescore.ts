import type { AppConfig, ModelRef } from "@/lib/config/schema";
import { JUDGE_PROMPT_VERSION } from "../scoring/judge";
import { runDeterministicChecks } from "../scoring/checks";
import { RETAIL_EVAL_TASKS } from "../tasks";
import { BENCHMARK_VERSION, type EvalRunSummary, type EvalTask, type TaskEvalResult } from "../types";
import { judgeRun } from "./rejudge";
import { budgetExhausted } from "./turn-bounds";

function currentTask(id: string): EvalTask {
  const task = RETAIL_EVAL_TASKS.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Cannot rescore unknown task "${id}" with benchmark v${BENCHMARK_VERSION}.`);
  return task;
}

function requireTrace(result: TaskEvalResult): void {
  const fields = ["toolCalls", "evidence", "checks", "figureMatches", "transcript"] as const;
  for (const field of fields) {
    if (!Array.isArray(result[field])) {
      throw new Error(`Cannot rescore ${result.task.id}: saved result has no ${field} trace. Baseline files intentionally omit traces; use a run JSON.`);
    }
  }
}

/**
 * Rebuild every deterministic v2 score from the original trace, then run the current item judge.
 * The caller writes the returned run under a fresh name; the input object is never mutated.
 */
export async function rescoreRun(
  saved: EvalRunSummary,
  config: AppConfig,
  judge: ModelRef,
  judgeRepeat: number,
): Promise<EvalRunSummary> {
  const summary = structuredClone(saved);
  for (const result of summary.results) {
    requireTrace(result);
    result.task = currentTask(result.task.id);
    result.deterministicCheck = runDeterministicChecks({
      task: result.task,
      toolCalls: result.toolCalls,
      finalText: result.finalAssistantText,
      sessionTickers: result.sessionTickers,
      evidence: result.evidence,
      figureMatches: result.figureMatches,
      reportFigureMatches: result.reportFigureMatches,
      evidenceAvailable: result.deterministicCheck.evidenceAvailable,
      fallbackReports: result.diagnostics.fallbackReports,
    });
    delete result.judgeResult;
    delete result.qualityScore;
    delete result.integrityScore;
    delete result.totalScore;

    const hasAnswer = result.finalAssistantText.trim().length > 0;
    if (result.status === "agent_timeout" || result.status === "agent_error" || !hasAnswer) {
      result.valid = true;
      delete result.invalidReason;
      result.totalScore = 0;
    } else if (result.status === "completed" || result.status === "agent_budget" || result.status === "judge_error") {
      result.status = budgetExhausted(result.stop) ? "agent_budget" : "completed";
      result.valid = true;
      delete result.invalidReason;
    }
  }

  summary.timestamp = new Date().toISOString();
  summary.benchmarkVersion = BENCHMARK_VERSION;
  summary.judgePromptVersion = JUDGE_PROMPT_VERSION;
  summary.judgeRepeat = judgeRepeat;
  summary.taskIds = summary.taskIds.map((id) => currentTask(id).id);
  return judgeRun(summary, config, judge);
}
