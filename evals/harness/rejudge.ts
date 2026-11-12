import type { AppConfig, ModelRef } from "@/lib/config/schema";
import { isAccountErrorText } from "@/lib/agent/transient-retries";
import { modelRefKey } from "@/lib/llm/catalog";
import { evaluateWithJudge, JUDGE_PROMPT_VERSION } from "../scoring/judge";
import { parseModelSpec } from "../models";
import { sumDiagnostics, summariseAgent } from "../reporting/summary";
import { judgeVersionIssues } from "../reporting/judge-versions";
import { budgetExhausted } from "./turn-bounds";
import { BENCHMARK_VERSION, type EvalRunSummary, type EvalTask, type JudgeEvaluationResult, type TaskEvalResult } from "../types";

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
    if (judgeResult.maxJudgeScore !== 60 || judgeResult.totalJudgeScore < 0 || judgeResult.totalJudgeScore > 60 || judgeResult.promptVersion !== JUDGE_PROMPT_VERSION) {
      throw new Error(`Expected a valid 60-point judge v${JUDGE_PROMPT_VERSION} result, got ${judgeResult.totalJudgeScore}/${judgeResult.maxJudgeScore} from v${judgeResult.promptVersion}.`);
    }
    if (result.deterministicCheck.maxScore !== 40 || result.deterministicCheck.version !== BENCHMARK_VERSION) {
      throw new Error(`Cannot combine a v${result.deterministicCheck.version ?? "unknown"} integrity score with v2 quality; use --rescore on a trace-bearing run.`);
    }
    result.status = budgetExhausted(result.stop) ? "agent_budget" : "completed";
    result.valid = true;
    delete result.invalidReason;
    result.qualityScore = judgeResult.totalJudgeScore;
    result.integrityScore = result.deterministicCheck.score;
    const uncapped = result.integrityScore + result.qualityScore;
    result.totalScore = Math.min(uncapped, judgeResult.scoreCap ?? 100);
  }
}

/**
 * A judge failure that is the judge's account refusing it (a sign-in's usage window, a key's
 * credit), not the answer or the request: every later grade would fail the same way.
 */
export function judgeAccountRefusal(judgeResult: JudgeEvaluationResult): string | undefined {
  if (!judgeResult.error) return undefined;
  const text = judgeResult.error.replace(/^Judge execution error:\s*/, "");
  return isAccountErrorText(text) ? text : undefined;
}

export type JudgeStageEvent =
  | { type: "judge_start"; result: TaskEvalResult; index: number; total: number }
  /** One answer graded (or failed for a reason of its own); `summary` is the run as it now stands. */
  | { type: "judged"; result: TaskEvalResult; summary: EvalRunSummary }
  /** The stage ended with answers still waiting: the judge's account refused, or the limit was reached. */
  | { type: "stopped"; reason: "account" | "limit"; detail?: string; pending: number };

export interface JudgeStageOptions {
  /** Grade at most this many answers, then stop (`--judge-limit`). */
  limit?: number;
  onEvent?: (event: JudgeStageEvent) => void;
}

/**
 * Finish grading a persisted run without spending another agent turn. Only missing/failed judges
 * run, at the judge thinking the run recorded, so every result was graded the same way. A stage
 * stops early at its limit or when the judge's account refuses it, leaving the rest waiting for the
 * next stage exactly as they were.
 */
export async function judgeRun(
  summary: EvalRunSummary,
  config: AppConfig,
  judge: ModelRef,
  options: JudgeStageOptions = {},
): Promise<EvalRunSummary> {
  if (summary.benchmarkVersion !== BENCHMARK_VERSION || summary.judgePromptVersion !== JUDGE_PROMPT_VERSION) {
    throw new Error(`Cannot judge benchmark v${summary.benchmarkVersion} / prompt v${summary.judgePromptVersion} with prompt v${JUDGE_PROMPT_VERSION}; use --rescore on a trace-bearing run.`);
  }
  const mixedVersions = judgeVersionIssues(summary);
  if (mixedVersions.length) throw new Error(`Cannot reuse mixed judge versions: ${mixedVersions.join("; ")}`);
  delete summary.calibration;
  const agents = summary.agents.map((spec) => {
    const agent = parseModelSpec(spec);
    if (!agent) throw new Error(`The saved run names an agent "${spec}" that is not a provider/model spec.`);
    return agent;
  });
  const snapshot = (): EvalRunSummary => ({
    ...summary,
    judge: modelRefKey(judge),
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    diagnostics: sumDiagnostics(summary.results),
    agentSummaries: agents.map((agent) => summariseAgent(agent, judge, runTasks(summary), summary.results)),
  });
  const waiting = summary.results.filter(awaitsJudgement);
  const pending = (): number => summary.results.filter(awaitsJudgement).length;
  let graded = 0;
  for (const result of waiting) {
    if (options.limit !== undefined && graded >= options.limit) {
      options.onEvent?.({ type: "stopped", reason: "limit", pending: waiting.length - graded });
      break;
    }
    options.onEvent?.({ type: "judge_start", result, index: graded + 1, total: waiting.length });
    const judgeResult = await evaluateWithJudge(result, config, judge, summary.judgeThinking, summary.judgeRepeat ?? 1);
    const refusal = judgeAccountRefusal(judgeResult);
    if (refusal) {
      // Not recorded on the result: it stays as the last stage left it, and the next one grades it.
      options.onEvent?.({ type: "stopped", reason: "account", detail: refusal, pending: pending() });
      break;
    }
    applyJudgement(result, judgeResult);
    graded += 1;
    options.onEvent?.({ type: "judged", result, summary: snapshot() });
  }
  return snapshot();
}
