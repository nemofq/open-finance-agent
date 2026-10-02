import { parseModelSpec } from "../models";
import { sumDiagnostics, summariseAgent } from "../reporting/summary";
import { runDeterministicChecks } from "../scoring/checks";
import { JUDGE_PROMPT_VERSION } from "../scoring/judge";
import { RETAIL_EVAL_TASKS } from "../tasks";
import { BENCHMARK_VERSION, type EvalRunSummary, type EvalTask, type TaskEvalResult } from "../types";
import { applyJudgement } from "./rejudge";

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
 * Rebuild v2 integrity from the original trace and reuse the saved 60-point judge verdict.
 * The caller writes a new run; the input object is never mutated or sent to a model.
 */
export function rescoreRun(saved: EvalRunSummary): EvalRunSummary {
  if (saved.judgePromptVersion !== JUDGE_PROMPT_VERSION) {
    throw new Error(`Cannot reuse judge prompt v${saved.judgePromptVersion}; this rescore requires v${JUDGE_PROMPT_VERSION}.`);
  }
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
    delete result.qualityScore;
    delete result.integrityScore;
    delete result.totalScore;

    if (result.status === "infra_error" || result.status === "harness_error" || result.status === "judge_error") {
      result.valid = false;
      continue;
    }
    if (result.status === "agent_timeout" || result.status === "agent_error" || !result.finalAssistantText.trim()) {
      if (result.status === "completed") result.status = "agent_error";
      result.valid = true;
      delete result.invalidReason;
      delete result.judgeResult;
      result.totalScore = 0;
      continue;
    }
    if (!result.judgeResult || result.judgeResult.error || result.judgeResult.promptVersion !== JUDGE_PROMPT_VERSION) {
      throw new Error(`Cannot rescore ${result.task.id} repeat ${result.repeat}: a valid v${JUDGE_PROMPT_VERSION} judge verdict is missing.`);
    }
    applyJudgement(result, result.judgeResult);
  }

  const agents = summary.agents.map((spec) => {
    const agent = parseModelSpec(spec);
    if (!agent) throw new Error(`The saved run names an invalid agent "${spec}".`);
    return agent;
  });
  const judge = parseModelSpec(summary.judge);
  if (!judge) throw new Error(`The saved run names an invalid judge "${summary.judge}".`);
  const tasks = summary.taskIds.map(currentTask);
  summary.timestamp = new Date().toISOString();
  summary.benchmarkVersion = BENCHMARK_VERSION;
  summary.diagnostics = sumDiagnostics(summary.results);
  summary.agentSummaries = agents.map((agent) => summariseAgent(agent, judge, tasks, summary.results));
  return summary;
}
