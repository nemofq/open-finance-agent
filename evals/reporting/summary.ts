import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { AppConfig, ModelRef } from "@/lib/config/schema";
import { maskSecrets } from "@/lib/config/secrets";
import { modelRefKey, sameModelRef } from "@/lib/llm/catalog";
import { addDiagnostics, emptyDiagnostics } from "./diagnostics";
import { aggregateMetrics } from "./metrics";
import { mean, noiseTolerance, round, standardDeviation } from "./stats";
import type { AgentSummary, EvalRunSummary, EvalTask, RunDiagnostics, TaskEvalResult, TaskStat } from "../types";

/** The run-level figures derived from its results: per-agent and per-task statistics and the run's identity. */

type Scored = TaskEvalResult & { totalScore: number };
type Completed = Scored & { judgeResult: NonNullable<TaskEvalResult["judgeResult"]> };

/** The results that count toward the scores: not invalidated, and given a total. */
function scoredResults(results: TaskEvalResult[]): Scored[] {
  return results.filter((result): result is Scored => result.valid !== false && result.totalScore !== undefined);
}

function completedResults(results: TaskEvalResult[]): Completed[] {
  return scoredResults(results).filter((result): result is Completed =>
    (result.status === "completed" || result.status === "agent_budget") && result.judgeResult !== undefined,
  );
}

function taskStats(task: EvalTask, results: TaskEvalResult[]): TaskStat {
  const valid = scoredResults(results);
  const completed = completedResults(results);
  const scores = valid.map((result) => result.totalScore);
  return {
    taskId: task.id,
    title: task.title,
    runs: valid.length,
    scores,
    meanIntegrity: round(mean(completed.map((result) => result.integrityScore ?? result.deterministicCheck.score))),
    meanQuality: round(mean(completed.map((result) => result.qualityScore ?? result.judgeResult.totalJudgeScore))),
    meanTotal: round(mean(scores)),
    sdTotal: round(standardDeviation(scores), 2),
    tolerance: round(noiseTolerance(scores), 2),
  };
}

/**
 * Model outcomes that end without a judgeable turn; they score zero rather than drop out. A budget
 * stop that still produced an answer was judged, so it is not a failure.
 */
function isAgentFailure(result: Pick<TaskEvalResult, "status" | "finalAssistantText">): boolean {
  if (result.status === "agent_budget") return !result.finalAssistantText.trim();
  return result.status === "agent_timeout" || result.status === "agent_error";
}

export function sumDiagnostics(results: TaskEvalResult[]): RunDiagnostics {
  return results.reduce((total, result) => addDiagnostics(total, result.diagnostics), emptyDiagnostics());
}

export function summariseAgent(agent: ModelRef, judge: ModelRef, tasks: EvalTask[], results: TaskEvalResult[]): AgentSummary {
  const mine = results.filter((result) => result.agent === modelRefKey(agent));
  const valid = scoredResults(mine);
  const completed = completedResults(mine);
  const perTask = tasks.map((task) => taskStats(task, mine.filter((result) => result.task.id === task.id)));
  const expectedUserScore = round(mean(perTask.filter((task) => task.runs > 0).map((task) => task.meanTotal)));
  const completionRate = valid.length === 0 ? 0 : round(completed.length / valid.length, 3);
  return {
    agent: modelRefKey(agent),
    selfJudged: sameModelRef(agent, judge),
    completedTasks: mine.filter((result) => result.status === "completed").length,
    erroredTasks: mine.filter((result) => result.status !== "completed").length,
    agentFailures: mine.filter((result) => isAgentFailure(result)).length,
    infrastructureErrors: mine.filter((result) => result.status === "infra_error").length,
    invalidRuns: mine.filter((result) => result.status === "harness_error" || result.status === "judge_error").length,
    completionRate,
    qualityOnCompleted: round(mean(completed.map((result) => result.totalScore))),
    expectedUserScore,
    averageIntegrityScore: round(mean(completed.map((result) => result.integrityScore ?? result.deterministicCheck.score))),
    averageSemanticScore: round(mean(completed.map((result) => result.qualityScore ?? result.judgeResult.totalJudgeScore))),
    averageTotalScore: expectedUserScore,
    maxPossibleScore: 100,
    perTask,
    metrics: aggregateMetrics(mine.map((result) => result.metrics)),
    diagnostics: sumDiagnostics(mine),
  };
}

/** SHA-256 of the run's config with every secret masked, so the hash identifies the setup, not the keys. */
export function configHash(config: AppConfig): string {
  return createHash("sha256").update(JSON.stringify(maskSecrets(config))).digest("hex").slice(0, 16);
}

export function headCommit(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

/** The offline dataset's identity and the offline audits summed over the run's results. */
export function datasetSummary(version: string, taskHashes: Record<string, string>, results: TaskEvalResult[]): NonNullable<EvalRunSummary["dataset"]> {
  return {
    version,
    taskHashes,
    corpusNotCaptured: results.reduce((total, result) => total + (result.offlineAudit?.corpusNotCaptured ?? 0), 0),
    notAvailableAsOf: results.reduce((total, result) => total + (result.offlineAudit?.notAvailableAsOf ?? 0), 0),
    emptyProviderResults: results.reduce((total, result) => total + (result.offlineAudit?.emptyProviderResults ?? 0), 0),
    outOfScopeQueries: results.reduce((total, result) => total + (result.offlineAudit?.outOfScopeQueries ?? 0), 0),
    integrityErrors: results.reduce((total, result) => total + (result.offlineAudit?.integrityErrors ?? 0), 0),
  };
}
