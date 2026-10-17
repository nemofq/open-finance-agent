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

const TRACE_FIELDS = ["toolCalls", "transcript", "evidence", "checks", "figureMatches", "reportFigureMatches"] as const;

export interface RescoreOptions {
  /** Rescore only these tasks; every other result keeps its saved scores and judgement untouched. */
  taskIds?: string[];
  /**
   * The trace-bearing run a baseline came from. A rescored result without traces takes them from the
   * same agent, task and repeat here, which must carry the same answer.
   */
  traces?: EvalRunSummary;
}

function withTraces(result: TaskEvalResult, traces: EvalRunSummary | undefined): void {
  if (!traces || Array.isArray(result.toolCalls)) return;
  const source = traces.results.find((candidate) =>
    candidate.agent === result.agent && candidate.task.id === result.task.id && candidate.repeat === result.repeat);
  if (!source) throw new Error(`The traces run has no ${result.agent} ${result.task.id} run ${result.repeat}.`);
  if (source.finalAssistantText !== result.finalAssistantText) {
    throw new Error(`The traces run's answer for ${result.task.id} run ${result.repeat} differs from the one being rescored.`);
  }
  for (const field of TRACE_FIELDS) {
    if (source[field] !== undefined) (result as unknown as Record<string, unknown>)[field] = structuredClone(source[field]);
  }
}

/**
 * Rebuild every deterministic v2 score from the original trace, then run the current item judge.
 * With `taskIds`, only those tasks are rebuilt and judged again, so a rubric change to one task
 * leaves every other grade as it was; that needs a run already on the current benchmark version.
 * The caller writes the returned run under a fresh name; the input object is never mutated.
 */
export async function rescoreRun(
  saved: EvalRunSummary,
  config: AppConfig,
  judge: ModelRef,
  judgeRepeat: number,
  options: RescoreOptions = {},
): Promise<EvalRunSummary> {
  const selected = options.taskIds?.length ? new Set(options.taskIds) : undefined;
  if (selected) {
    if (saved.benchmarkVersion !== BENCHMARK_VERSION) {
      throw new Error(`Rescoring some tasks needs a benchmark v${BENCHMARK_VERSION} run, not v${saved.benchmarkVersion}: the other tasks keep their grades. Rescore the whole run instead.`);
    }
    if ((saved.judgeRepeat ?? 1) !== judgeRepeat) {
      throw new Error(`The run was graded with ${saved.judgeRepeat ?? 1} judge repeat(s); rescore its tasks with the same --judge-repeat so every task is graded alike.`);
    }
    for (const id of selected) currentTask(id);
  }
  const summary = structuredClone(saved);
  for (const result of summary.results) {
    if (selected && !selected.has(result.task.id)) continue;
    withTraces(result, options.traces);
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
