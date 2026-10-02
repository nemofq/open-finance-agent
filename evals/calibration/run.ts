import type { AppConfig, ModelRef, ThinkingLevel } from "@/lib/config/schema";
import { aggregateJudgeEvaluations, evaluateWithJudge } from "../scoring/judge";
import { RETAIL_EVAL_TASKS } from "../tasks";
import type { EvalRunSummary, JudgeEvaluationResult } from "../types";
import { EVAL_ANCHORS, type AnchorSeverity } from "./anchors";

const LEVELS: AnchorSeverity[] = ["adversarial", "partial", "good"];

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function totalScore(result: JudgeEvaluationResult): number {
  return Math.min(40 + result.totalJudgeScore, result.scoreCap ?? 100);
}

function severity(score: number): AnchorSeverity {
  return score >= 80 ? "good" : score >= 50 ? "partial" : "adversarial";
}

function distanceFromExpectedBand(score: number, band: { min: number; max: number }): number {
  if (score < band.min) return band.min - score;
  if (score > band.max) return score - band.max;
  return 0;
}

/** Quadratic weighted Cohen's kappa over the three ordered severity labels. */
function weightedKappa(expected: AnchorSeverity[], observed: AnchorSeverity[]): number {
  const size = LEVELS.length;
  const observedMatrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const expectedCounts = Array<number>(size).fill(0);
  const observedCounts = Array<number>(size).fill(0);
  for (let index = 0; index < expected.length; index++) {
    const row = LEVELS.indexOf(expected[index]);
    const column = LEVELS.indexOf(observed[index]);
    observedMatrix[row][column] += 1;
    expectedCounts[row] += 1;
    observedCounts[column] += 1;
  }
  let weightedObserved = 0;
  let weightedExpected = 0;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const weight = ((row - column) / (size - 1)) ** 2;
      weightedObserved += weight * observedMatrix[row][column] / expected.length;
      weightedExpected += weight * (expectedCounts[row] * observedCounts[column]) / (expected.length ** 2);
    }
  }
  return weightedExpected === 0 ? (weightedObserved === 0 ? 1 : 0) : 1 - weightedObserved / weightedExpected;
}

export async function calibrateJudge(
  config: AppConfig,
  judge: ModelRef,
  thinking: ThinkingLevel | undefined,
  repeats = 3,
): Promise<NonNullable<EvalRunSummary["calibration"]>> {
  const scored: Array<{ taskId: string; expected: AnchorSeverity; score: number; stdDev: number }> = [];
  for (const anchor of EVAL_ANCHORS) {
    const task = RETAIL_EVAL_TASKS.find((candidate) => candidate.id === anchor.taskId);
    if (!task) throw new Error(`Calibration anchor ${anchor.id} names unknown task ${anchor.taskId}.`);
    const evaluations: JudgeEvaluationResult[] = [];
    for (let repeat = 0; repeat < repeats; repeat++) {
      const result = await evaluateWithJudge({ task, toolCalls: [], evidence: [], checks: [], finalAssistantText: anchor.answer }, config, judge, thinking, 1);
      if (result.error) throw new Error(`Calibration anchor ${anchor.id} failed: ${result.error}`);
      evaluations.push(result);
    }
    const aggregate = aggregateJudgeEvaluations(evaluations, task, evaluations[0].judgeModel);
    scored.push({ taskId: task.id, expected: anchor.severity, score: totalScore(aggregate), stdDev: stdDev(evaluations.map(totalScore)) });
  }

  const ordered = RETAIL_EVAL_TASKS.filter((task) => {
    const scores = Object.fromEntries(scored.filter((item) => item.taskId === task.id).map((item) => [item.expected, item.score]));
    return scores.good > scores.partial && scores.partial > scores.adversarial;
  }).length;
  const expected = scored.map((item) => item.expected);
  const observed = scored.map((item) => severity(item.score));
  const mae = mean(scored.map((item, index) => distanceFromExpectedBand(item.score, EVAL_ANCHORS[index].expectedScore)));
  const summary = {
    anchors: scored.length,
    repeats,
    orderingAccuracy: round(ordered / RETAIL_EVAL_TASKS.length),
    weightedKappa: round(weightedKappa(expected, observed)),
    scoreMae: round(mae),
    maxScoreStdDev: round(Math.max(...scored.map((item) => item.stdDev))),
    passed: false,
  };
  summary.passed = summary.orderingAccuracy >= 0.95 && summary.weightedKappa >= 0.75 && summary.scoreMae <= 5 && summary.maxScoreStdDev <= 3;
  return summary;
}
