import type { EvalRunSummary, TaskEvalResult } from "../types";

export interface TaskDelta {
  taskId: string;
  meanDelta: number;
  newCriticalContradiction: boolean;
}

export interface AgentComparison {
  candidateAgent: string;
  baselineAgent: string;
  pairs: number;
  meanDelta: number;
  lower95: number;
  wins: number;
  ties: number;
  losses: number;
  completionDelta: number;
  criticalContradictionDelta: number;
  taskDeltas: TaskDelta[];
  passed: boolean;
  blockers: string[];
}

export interface RunComparison {
  benchmarkVersion: string;
  comparisons: AgentComparison[];
}

function round(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function completed(result: TaskEvalResult): boolean {
  return result.valid !== false && (result.status === "completed" || result.status === "agent_budget") && Boolean(result.judgeResult && !result.judgeResult.error);
}

function criticalContradiction(result: TaskEvalResult): boolean {
  return (result.judgeResult?.criticalContradictions.length ?? 0) > 0;
}

function key(result: TaskEvalResult): string {
  return `${result.task.id}:${result.repeat}`;
}

function score(result: TaskEvalResult): number {
  if (result.valid === false || result.totalScore === undefined) {
    throw new Error(`Cannot compare invalid/unscored cell ${result.agent}/${key(result)}.`);
  }
  return result.totalScore;
}

/** Fixed-seed paired bootstrap so a checked-in comparison is reproducible. */
function bootstrapLower95(deltas: number[], samples = 10_000): number {
  if (deltas.length === 0) throw new Error("Cannot bootstrap an empty paired sample.");
  let state = 0x51f15e;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const means: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    let total = 0;
    for (let index = 0; index < deltas.length; index++) total += deltas[Math.floor(random() * deltas.length)] ?? 0;
    means.push(total / deltas.length);
  }
  means.sort((a, b) => a - b);
  return round(means[Math.floor(samples * 0.05)] ?? means[0]);
}

function comparisonFor(candidateAgent: string, baselineAgent: string, candidate: EvalRunSummary, baseline: EvalRunSummary): AgentComparison {
  const candidateResults = candidate.results.filter((result) => result.agent === candidateAgent);
  const baselineResults = baseline.results.filter((result) => result.agent === baselineAgent);
  const baselineByKey = new Map(baselineResults.map((result) => [key(result), result]));
  if (candidateResults.length !== baselineResults.length) {
    throw new Error(`Cannot compare ${candidateAgent}: candidate has ${candidateResults.length} cells and baseline has ${baselineResults.length}.`);
  }

  const pairs = candidateResults.map((result) => {
    const previous = baselineByKey.get(key(result));
    if (!previous) throw new Error(`Baseline has no paired cell for ${candidateAgent}/${key(result)}.`);
    return { result, previous, delta: score(result) - score(previous) };
  });
  const deltas = pairs.map((pair) => pair.delta);
  const meanDelta = round(deltas.reduce((total, value) => total + value, 0) / deltas.length);
  const completionDelta = round(
    candidateResults.filter(completed).length / candidateResults.length - baselineResults.filter(completed).length / baselineResults.length,
    3,
  );
  const criticalContradictionDelta = round(
    candidateResults.filter(criticalContradiction).length / candidateResults.length - baselineResults.filter(criticalContradiction).length / baselineResults.length,
    3,
  );

  const taskDeltas = candidate.taskIds.map((taskId) => {
    const taskPairs = pairs.filter((pair) => pair.result.task.id === taskId);
    const candidateContradictions = taskPairs.filter((pair) => criticalContradiction(pair.result)).length;
    const baselineContradictions = taskPairs.filter((pair) => criticalContradiction(pair.previous)).length;
    return {
      taskId,
      meanDelta: round(taskPairs.reduce((total, pair) => total + pair.delta, 0) / taskPairs.length),
      newCriticalContradiction: candidateContradictions >= Math.ceil(taskPairs.length * 2 / 3) && baselineContradictions < Math.ceil(taskPairs.length * 2 / 3),
    };
  });
  const lower95 = bootstrapLower95(deltas);
  const blockers = [
    ...(completionDelta < -0.05 ? [`completion fell ${(Math.abs(completionDelta) * 100).toFixed(1)} percentage points (limit 5)`] : []),
    ...(lower95 < -2 ? [`expected-score lower 95% bound is ${lower95} (limit -2)`] : []),
    ...taskDeltas.filter((task) => task.newCriticalContradiction).map((task) => `${task.taskId} added a critical contradiction in at least 2/3 repeats`),
    ...taskDeltas.filter((task) => task.meanDelta < -8).map((task) => `${task.taskId} fell ${Math.abs(task.meanDelta)} points (limit 8)`),
  ];

  return {
    candidateAgent,
    baselineAgent,
    pairs: pairs.length,
    meanDelta,
    lower95,
    wins: deltas.filter((delta) => delta > 0).length,
    ties: deltas.filter((delta) => delta === 0).length,
    losses: deltas.filter((delta) => delta < 0).length,
    completionDelta,
    criticalContradictionDelta,
    taskDeltas,
    passed: blockers.length === 0,
    blockers,
  };
}

export function compareRuns(candidate: EvalRunSummary, baseline: EvalRunSummary): RunComparison {
  if (candidate.benchmarkVersion !== baseline.benchmarkVersion) {
    throw new Error(`Cannot compare benchmark v${candidate.benchmarkVersion} with v${baseline.benchmarkVersion}; rescore the old run first.`);
  }
  if (candidate.taskIds.join("\0") !== baseline.taskIds.join("\0") || candidate.repeat !== baseline.repeat) {
    throw new Error("Candidate and baseline must contain the same tasks in the same order and the same repeat count.");
  }
  const oneToOne = candidate.agents.length === 1 && baseline.agents.length === 1;
  const comparisons = candidate.agents.map((agent) => {
    const baselineAgent = baseline.agents.includes(agent) ? agent : oneToOne ? baseline.agents[0] : undefined;
    if (!baselineAgent) throw new Error(`Baseline has no agent matching ${agent}.`);
    return comparisonFor(agent, baselineAgent, candidate, baseline);
  });
  return { benchmarkVersion: candidate.benchmarkVersion, comparisons };
}

export function renderComparison(comparison: RunComparison): string {
  const lines = [`Eval v${comparison.benchmarkVersion} paired comparison`];
  for (const result of comparison.comparisons) {
    lines.push(
      `- ${result.candidateAgent} vs ${result.baselineAgent}: ${result.passed ? "PASS" : "BLOCK"}; Δ ${result.meanDelta}, one-sided 95% lower ${result.lower95}, W/T/L ${result.wins}/${result.ties}/${result.losses}, completion Δ ${(result.completionDelta * 100).toFixed(1)}pp, critical-contradiction Δ ${(result.criticalContradictionDelta * 100).toFixed(1)}pp`,
    );
    for (const blocker of result.blockers) lines.push(`  - ${blocker}`);
  }
  return lines.join("\n");
}
