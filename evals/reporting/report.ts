import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIMITS } from "@/lib/agent/execution";
import { writeFileAtomicSync } from "@/lib/atomic-write";
import {
  type AgentSummary,
  type BaselineRecord,
  type EvalRunSummary,
  type RunDiagnostics,
  type RunMetrics,
  type TaskEvalResult,
} from "../types";

/**
 * Run artefacts. Raw runs go to `evals/results/`, which is gitignored; a run worth
 * keeping is promoted into `evals/baselines/` without its traces, small enough to commit and diff.
 */

function timestampSlug(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

/** Model specs contain slashes; a baseline file name must not. */
export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The convention `evals/README.md` documents: `<date>-<agent>-<judge>.json`. */
export function suggestBaselineName(summary: EvalRunSummary): string {
  const date = summary.timestamp.slice(0, 10);
  return `${date}-${slug(summary.agents[0] ?? "agent")}-${slug(summary.judge)}`;
}

/** The per-task trace fields a baseline leaves out. */
const TRACE_FIELDS = ["toolCalls", "transcript", "evidence", "checks", "figureMatches", "reportFigureMatches"] as const;

/** A baseline keeps the scores and the metrics, never the traces, so the file stays reviewable. */
export function toBaseline(summary: EvalRunSummary): BaselineRecord {
  return {
    ...summary,
    results: summary.results.map((result) => {
      const kept = { ...result };
      for (const field of TRACE_FIELDS) delete kept[field];
      return kept;
    }),
  };
}

function metricsRows(metrics: RunMetrics): string[] {
  const rate = metrics.unsourcedFigureRate < 0 ? "n/a (no ledger)" : `${(metrics.unsourcedFigureRate * 100).toFixed(1)}%`;
  const tiers = Object.entries(metrics.sourceTierMix)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([tier, count]) => `${tier}: ${count}`)
    .join(", ");
  return [
    `| Unsourced figures | ${rate} |`,
    `| Source tier mix | ${tiers || "none"} |`,
    `| Conflicts (addressed / detected) | ${metrics.conflictsAddressed} / ${metrics.conflictsDetected} |`,
    `| Look-ahead evidence | ${metrics.lookAheadEvidence} |`,
    `| Evidence entries | ${metrics.evidenceEntries} |`,
    `| Follow-ups / blocks / flags | ${metrics.followUps} / ${metrics.blocks} / ${metrics.flags} |`,
    `| Tokens (in / out / total) | ${metrics.tokens.input} / ${metrics.tokens.output} / ${metrics.tokens.total} |`,
    `| Cost | $${metrics.costUsd.toFixed(4)} |`,
    `| Mean latency | ${(metrics.latencyMs / 1000).toFixed(1)}s |`,
    `| Model calls | ${metrics.modelCalls} |`,
  ];
}

function diagnosticsLine(diagnostics: RunDiagnostics): string {
  return `tool argument errors ${diagnostics.toolArgumentErrors} · fallback reports ${diagnostics.fallbackReports} · unverified report figures ${diagnostics.unverifiedFigures} · repaired report figures ${diagnostics.repairedFigures}`;
}

/** Printed beside a self-judged score: a model grading itself cannot set a baseline. */
export const SELF_JUDGED_LABEL = "self-judged: not baseline-eligible";

/**
 * The run-level spread: the mean of the per-task standard deviations over the tasks with more than
 * one scored run. Undefined when no task was repeated, because one run has no spread to measure.
 */
export function meanTaskSpread(summary: AgentSummary): number | undefined {
  const repeated = summary.perTask.filter((task) => task.runs > 1);
  if (repeated.length === 0) return undefined;
  return Math.round((repeated.reduce((total, task) => total + task.sdTotal, 0) / repeated.length) * 100) / 100;
}

/** One agent's headline: its scores, the self-judged caveat and, for a repeated run, the spread. */
export function scoreLine(summary: AgentSummary, repeat: number): string {
  const spread = repeat > 1 ? meanTaskSpread(summary) : undefined;
  return (
    `completion ${(summary.completionRate * 100).toFixed(1)}% · completed quality ${summary.qualityOnCompleted}/100 · expected ${summary.expectedUserScore}/100` +
    ` · integrity ${summary.averageIntegrityScore}/20 · semantic ${summary.averageSemanticScore}/80` +
    (summary.selfJudged ? ` (${SELF_JUDGED_LABEL})` : "") +
    (spread === undefined ? "" : ` · mean per-task σ ${spread}`)
  );
}

/**
 * Why a run may not become a baseline, before or after it runs: a model grading itself, or a
 * single repeat, which measures no noise and so gives no tolerance to compare against.
 */
export function baselineRefusal(options: { repeat: number; selfJudged: boolean }): string | undefined {
  const reasons: string[] = [];
  if (options.selfJudged) reasons.push("the judge is the same model as an agent (self-judged)");
  if (options.repeat < 2) reasons.push(`it has ${options.repeat} repeat; a baseline needs --repeat 2 or more to measure its spread`);
  return reasons.length === 0 ? undefined : `--baseline refuses this run: ${reasons.join("; and ")}.`;
}

function agentSection(summary: AgentSummary, repeat: number): string[] {
  const spread = repeat > 1 ? meanTaskSpread(summary) : undefined;
  const lines = [
    `## ${summary.agent}${summary.selfJudged ? " — self-judged" : ""}`,
    ``,
    `- Completion: **${(summary.completionRate * 100).toFixed(1)}%** · Completed quality: **${summary.qualityOnCompleted} / 100** · Expected user score: **${summary.expectedUserScore} / 100**${summary.selfJudged ? ` — ${SELF_JUDGED_LABEL}` : ""}`,
    `- Integrity: **${summary.averageIntegrityScore} / 20** · Semantic: **${summary.averageSemanticScore} / 80** (existing judge rubric scaled from 60)`,
    ...(spread === undefined ? [] : [`- Spread: mean per-task σ **${spread}** over ${summary.perTask.filter((task) => task.runs > 1).length} repeated task(s)`]),
    `- Completed tasks: ${summary.completedTasks} · agent failures scored zero: ${summary.agentFailures} · infrastructure errors excluded: ${summary.infrastructureErrors} · harness/judge errors: ${summary.invalidRuns}`,
    `- Diagnostics: ${diagnosticsLine(summary.diagnostics)}`,
    ``,
    repeat > 1 ? `| Task | Integrity | Semantic | Expected | σ |` : `| Task | Integrity | Semantic | Expected |`,
    repeat > 1 ? `| :--- | ---: | ---: | ---: | ---: |` : `| :--- | ---: | ---: | ---: |`,
  ];

  for (const task of summary.perTask) {
    const unavailable = task.runs === 0;
    lines.push(
      repeat > 1
        ? `| ${task.title} | ${unavailable ? "—" : task.meanIntegrity} | ${unavailable ? "—" : task.meanQuality} | **${unavailable ? "unscored" : task.meanTotal}** | ${unavailable ? "—" : task.sdTotal} |`
        : `| ${task.title} | ${unavailable ? "—" : task.meanIntegrity} | ${unavailable ? "—" : task.meanQuality} | **${unavailable ? "unscored" : task.meanTotal}** |`,
    );
  }

  lines.push(``, `| Metric | Value |`, `| :--- | :--- |`, ...metricsRows(summary.metrics), ``);
  return lines;
}

function resultSection(result: TaskEvalResult): string[] {
  const lines = [
    `### ${result.task.title} — ${result.agent}${result.repeat > 1 ? ` (run ${result.repeat})` : ""}`,
    `- Prompt: *"${result.task.prompt}"*`,
    `- As-of: ${result.task.asOfDate} · Duration: ${(result.durationMs / 1000).toFixed(1)}s · Budget: ${LIMITS.calls} calls and ${LIMITS.turnMs / 60_000}m per turn`,
    `- Status: **${result.status}**`,
    `- Integrity: ${result.deterministicCheck.score} / 20${result.status === "agent_timeout" || result.status === "agent_error" || (result.status === "agent_budget" && !result.judgeResult) ? " (partial progress; expected score remains zero without a judgeable answer)" : result.deterministicCheck.evidenceAvailable ? "" : " (no ledger)"}`,
  ];

  if (result.judgeResult) {
    const judge = result.judgeResult;
    lines.push(
      `- Judge: ${judge.totalJudgeScore} / 60 (intent ${judge.intentScore}/15, financial ${judge.financialScore}/20, grounding ${judge.groundingScore}/15, clarity ${judge.retailClarityScore}/10); semantic contribution: ${result.qualityScore ?? "N/A"} / 80`,
      result.totalScore === undefined ? `- Total: **unscored**` : `- Total: **${result.totalScore} / 100**`,
      `- Verdict: ${judge.overallVerdict}`,
    );
  } else if (result.totalScore !== undefined) {
    lines.push(`- Total: **${result.totalScore} / 100** (model execution did not reach a judgeable final answer)`);
  } else {
    lines.push(`- Total: **unscored**`);
  }

  lines.push(`- Diagnostics: ${diagnosticsLine(result.diagnostics)}`);

  if (result.providerRetries) {
    lines.push(`- Provider retries: ${result.providerRetries}${result.providerRetryErrors?.length ? ` (${result.providerRetryErrors.join("; ")})` : ""}`);
  }

  lines.push(
    `- Tools (${result.toolCalls.length}): ${result.toolCalls.map((call) => `\`${call.toolName}\`${call.offlineOutcome === "not_captured" ? " (corpus not captured)" : call.offlineOutcome === "out_of_scope" ? " (out of scope)" : call.offlineOutcome === "not_available_as_of" ? " (future-blocked)" : ""}`).join(", ") || "none"}`,
    `- Check notes:`,
    ...result.deterministicCheck.details.map((detail) => `  - ${detail}`),
  );

  if (result.offlineAudit) {
    lines.push(
      `- Offline audit: corpus-not-captured ${result.offlineAudit.corpusNotCaptured} · future-blocked ${result.offlineAudit.notAvailableAsOf} · empty ${result.offlineAudit.emptyProviderResults} · out-of-scope ${result.offlineAudit.outOfScopeQueries} · integrity ${result.offlineAudit.integrityErrors}`,
    );
  }

  if (result.judgeResult?.intentFeedback) {
    lines.push(
      `- Judge feedback:`,
      `  - Intent: ${result.judgeResult.intentFeedback}`,
      `  - Financial reasoning: ${result.judgeResult.financialFeedback}`,
      `  - Grounding: ${result.judgeResult.groundingFeedback}`,
      `  - Clarity: ${result.judgeResult.retailClarityFeedback}`,
    );
  }
  if (result.error) lines.push(`- ⚠️ Execution error: \`${result.error}\``);
  if (result.valid === false) lines.push(`- ⛔ Invalid/unscored: ${result.invalidReason ?? "benchmark validity check failed"}`);
  lines.push(``);
  return lines;
}

/** " · sent: `agent` high → "xhigh"", one entry per model, when the run recorded it. */
function thinkingSentText(sent: EvalRunSummary["thinkingTransmitted"]): string {
  const entries = Object.entries(sent ?? {});
  if (entries.length === 0) return "";
  return ` · **Sent:** ${entries.map(([agent, wire]) => `\`${agent}\` ${wire}`).join(", ")}`;
}

export function renderSummaryMarkdown(summary: EvalRunSummary): string {
  const selfJudged = summary.agentSummaries.some((agent) => agent.selfJudged);
  const issues = benchmarkValidityIssues(summary);
  const lines = [
    `# Open Finance Agent — developer benchmark`,
    ``,
    `- **Run:** ${summary.timestamp}`,
    `- **Benchmark version:** ${summary.benchmarkVersion} · **Judge prompt:** v${summary.judgePromptVersion}`,
    `- **Agents:** ${summary.agents.map((agent) => `\`${agent}\``).join(", ")}`,
    `- **Judge:** \`${summary.judge}\`${selfJudged ? " — **self-judged**" : ""}`,
    ...(summary.thinking ? [`- **Thinking:** ${summary.thinking}${thinkingSentText(summary.thinkingTransmitted)}`] : []),
    ...(summary.judgeThinking ? [`- **Judge thinking:** ${summary.judgeThinking}${thinkingSentText(summary.judgeThinkingTransmitted)}`] : []),
    `- **Fixtures:** ${summary.fixtureMode} · **Policy:** ${summary.policyMode}`,
    ...(summary.dataset ? [`- **Offline dataset:** format ${summary.dataset.version} · ${Object.keys(summary.dataset.taskHashes).length} task dataset hashes · ${summary.dataset.integrityErrors} integrity errors · ${summary.dataset.corpusNotCaptured} corpus-not-captured · ${summary.dataset.emptyProviderResults} empty results · ${summary.dataset.notAvailableAsOf} future-blocked · ${summary.dataset.outOfScopeQueries} out-of-scope`] : []),
    `- **Tasks:** ${summary.taskIds.length} × ${summary.repeat} repeat(s)`,
    `- **Diagnostics:** ${diagnosticsLine(summary.diagnostics)}`,
    `- **Config hash:** \`${summary.configHash}\`${summary.commit ? ` · **Commit:** \`${summary.commit.slice(0, 12)}\`` : ""}`,
    `- **Status:** ${issues.length === 0 ? "valid" : `**INVALID / UNSCORED** — ${issues.join("; ")}`}`,
    ``,
  ];

  for (const agent of summary.agentSummaries) lines.push(...agentSection(agent, summary.repeat));

  lines.push(`## Detailed results`, ``);
  for (const result of summary.results) lines.push(...resultSection(result));

  return lines.join("\n");
}

export interface RunFiles {
  jsonPath: string;
  mdPath: string;
}

/** Write the full run (traces included) and the readable summary. */
export function writeRunFiles(summary: EvalRunSummary, outDir: string): RunFiles {
  mkdirSync(outDir, { recursive: true });
  const base = timestampSlug(summary.timestamp);
  const json = `${JSON.stringify(summary, null, 2)}\n`;
  const markdown = `${renderSummaryMarkdown(summary)}\n`;

  for (let attempt = 0; ; attempt += 1) {
    const stamp = attempt === 0 ? base : `${base}-${process.pid}${attempt === 1 ? "" : `-${attempt - 1}`}`;
    const jsonPath = path.join(outDir, `run-${stamp}.json`);
    const mdPath = path.join(outDir, `summary-${stamp}.md`);
    try {
      // Isolated CLI runs can begin in the same millisecond, so reserve the name atomically.
      writeFileSync(jsonPath, json, { encoding: "utf8", flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    writeFileSync(mdPath, markdown, { encoding: "utf8", flag: "wx" });
    return { jsonPath, mdPath };
  }
}

export function writeBaseline(summary: EvalRunSummary, name: string, dir: string): string {
  const issues = benchmarkValidityIssues(summary, { baseline: true });
  if (issues.length > 0) throw new Error(`Refusing to write an invalid baseline: ${issues.join("; ")}`);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug(name)}.json`);
  writeFileAtomicSync(file, `${JSON.stringify(toBaseline(summary), null, 2)}\n`);
  return file;
}

/** Reasons a run cannot be compared or promoted. Raw diagnostic files are still always written. */
export function benchmarkValidityIssues(
  summary: EvalRunSummary,
  options: { baseline?: boolean } = {},
): string[] {
  const issues: string[] = [];
  if (summary.fixtureMode !== "offline") issues.push(`fixture mode is ${summary.fixtureMode}, not offline`);
  const integrityErrors = summary.dataset?.integrityErrors ?? 0;
  if (integrityErrors > 0) issues.push(`${integrityErrors} offline dataset integrity error(s)`);
  const invalid = summary.results.filter((result) => result.valid === false || result.totalScore === undefined);
  if (invalid.length > 0) issues.push(`${invalid.length} invalid/unscored result(s)`);
  const judgeFailures = summary.results.filter((result) => result.judgeResult?.error);
  if (judgeFailures.length > 0) issues.push(`${judgeFailures.length} judge failure(s)`);
  if (options.baseline) {
    const refusal = baselineRefusal({ repeat: summary.repeat, selfJudged: summary.agentSummaries.some((agent) => agent.selfJudged) });
    if (refusal) issues.push(refusal);
  }
  return issues;
}
