import type { EvidenceEntry, FigureMatch } from "@/lib/evidence/types";
import type { CheckRecord } from "@/lib/policy/types";
import type { TurnUsage } from "@/lib/agent/turn-types";
import { mean, round } from "./stats";
import type { RunMetrics } from "../types";

/**
 * Everything the benchmark reports but does not score. These are the numbers the
 * calibration loop watches when a rule group moves from observe to enforce.
 */

/** Non-exempt figures in a text and how many of them the ledger backs. */
export function figureCoverage(matches: FigureMatch[]): { checked: number; backed: number; unsourced: string[] } {
  const checked = matches.filter((match) => !match.figure.exempt);
  const unsourced = checked.filter((match) => match.matches.length === 0);
  return {
    checked: checked.length,
    backed: checked.length - unsourced.length,
    unsourced: unsourced.map((match) => match.figure.raw),
  };
}

function tierMix(entries: EvidenceEntry[]): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const entry of entries) {
    const key = entry.source ? `tier${entry.source.tier}` : "unsourced";
    mix[key] = (mix[key] ?? 0) + 1;
  }
  return mix;
}

/** A conflict counts as addressed when a conflict resolution check names either side of it. */
function conflicts(entries: EvidenceEntry[], checks: CheckRecord[]): { detected: number; addressed: number } {
  const named = new Set(checks.filter((check) => check.rule === "P5").flatMap((check) => check.evidence ?? []));
  let detected = 0;
  let addressed = 0;
  for (const entry of entries) {
    for (const conflict of entry.conflicts ?? []) {
      if (conflict.agree) continue;
      detected += 1;
      if (named.has(entry.id) || named.has(conflict.with)) addressed += 1;
    }
  }
  return { detected, addressed };
}

export interface MetricsInput {
  evidence: EvidenceEntry[];
  checks: CheckRecord[];
  figureMatches: FigureMatch[];
  /** True when a ledger backed the figure matches; otherwise the unsourced rate is unknown. */
  evidenceAvailable: boolean;
  followUps: number;
  usage: TurnUsage;
  durationMs: number;
}

export function computeMetrics(input: MetricsInput): RunMetrics {
  const coverage = figureCoverage(input.figureMatches);
  const conflict = conflicts(input.evidence, input.checks);
  const { usage } = input;

  return {
    unsourcedFigureRate:
      input.evidenceAvailable && coverage.checked > 0 ? round((coverage.checked - coverage.backed) / coverage.checked, 3) : -1,
    unsourcedFigures: coverage.unsourced,
    sourceTierMix: tierMix(input.evidence),
    conflictsDetected: conflict.detected,
    conflictsAddressed: conflict.addressed,
    lookAheadEvidence: input.evidence.filter((entry) => entry.lookAhead === true).length,
    evidenceEntries: input.evidence.length,
    followUps: input.followUps,
    blocks: input.checks.filter((check) => check.kind === "block").length,
    flags: input.checks.filter((check) => check.kind === "flag").length,
    tokens: {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      total: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
    },
    costUsd: usage.cost,
    latencyMs: input.durationMs,
    modelCalls: usage.calls,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Roll several task runs into one row: counts add up, rates average over the runs that know theirs. */
export function aggregateMetrics(all: RunMetrics[]): RunMetrics {
  const known = all.map((metrics) => metrics.unsourcedFigureRate).filter((rate) => rate >= 0);
  const mix: Record<string, number> = {};
  for (const metrics of all) {
    for (const [tier, count] of Object.entries(metrics.sourceTierMix)) mix[tier] = (mix[tier] ?? 0) + count;
  }

  return {
    unsourcedFigureRate: known.length > 0 ? round(mean(known), 3) : -1,
    unsourcedFigures: all.flatMap((metrics) => metrics.unsourcedFigures),
    sourceTierMix: mix,
    conflictsDetected: sum(all.map((m) => m.conflictsDetected)),
    conflictsAddressed: sum(all.map((m) => m.conflictsAddressed)),
    lookAheadEvidence: sum(all.map((m) => m.lookAheadEvidence)),
    evidenceEntries: sum(all.map((m) => m.evidenceEntries)),
    followUps: sum(all.map((m) => m.followUps)),
    blocks: sum(all.map((m) => m.blocks)),
    flags: sum(all.map((m) => m.flags)),
    tokens: {
      input: sum(all.map((m) => m.tokens.input)),
      output: sum(all.map((m) => m.tokens.output)),
      cacheRead: sum(all.map((m) => m.tokens.cacheRead)),
      cacheWrite: sum(all.map((m) => m.tokens.cacheWrite)),
      total: sum(all.map((m) => m.tokens.total)),
    },
    costUsd: round(sum(all.map((m) => m.costUsd)), 4),
    latencyMs: Math.round(mean(all.map((m) => m.latencyMs))),
    modelCalls: sum(all.map((m) => m.modelCalls)),
  };
}
