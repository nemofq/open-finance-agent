/**
 * Prints the generated part of a baseline's section in evals/baselines/README.md: the Scores,
 * Critical caps and Diagnostics lines and the per-task table. The Agent, Judge, Commit and Cost
 * lines and any notes are written by hand.
 *
 *   node scripts/baseline-section.mjs evals/baselines/<baseline>.json
 *
 * Each per-task value is over the task's runs, as the baselines doc describes: integrity and judge
 * columns average the completed answers, Total is the task's mean `totalScore` with its population
 * standard deviation, Capped counts the answers a critical cap actually lowered, and run time and
 * output tokens are means per run. Long lines are wrapped at 100 columns, as the doc is.
 * Dependency-free ESM, Node >= 24.
 */

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/baseline-section.mjs <baseline.json>");
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(file, "utf8"));
const summary = baseline.agentSummaries[0];

const one = (value) => value.toFixed(1);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const whole = (value) => Math.round(value).toLocaleString("en-US");
const flagged = (result) => {
  const judge = result.judgeResult;
  return Boolean(judge) && (judge.criticalMisses?.length ?? 0) + (judge.criticalContradictions?.length ?? 0) > 0;
};
/** Points a critical cap took off an answer: what its integrity and judged scores add up to, less its total. */
const capCost = (result) => (flagged(result) ? Math.max(0, result.integrityScore + result.qualityScore - result.totalScore) : 0);
const capped = (result) => capCost(result) > 0.05;

const rows = summary.perTask.map((task) => {
  const results = baseline.results.filter((result) => result.task.id === task.taskId);
  const judged = results.filter((result) => result.status === "completed" && result.judgeResult);
  const check = (key) => one(mean(judged.map((result) => result.deterministicCheck[key])));
  const dimension = (key) => one(mean(judged.map((result) => result.judgeResult.dimensionScores[key])));
  return `| \`${task.taskId}\` | ${check("evidenceScore")} | ${check("figureSupportScore")} | ${check("contractScore")} | ` +
    `${dimension("intent")} | ${dimension("financial")} | ${dimension("grounding")} | ${dimension("clarity")} | ` +
    `${one(task.meanTotal)} (${one(task.sdTotal)}) | ${results.filter(capped).length} | ` +
    `${whole(mean(results.map((result) => result.durationMs)) / 1000)} s | ${whole(mean(results.map((result) => result.metrics.tokens.output)))} |`;
});

const caps = { contradicted: {}, missed: {} };
let flaggedAnswers = 0, cappedAnswers = 0, pointsLost = 0;
for (const result of baseline.results) {
  if (!result.judgeResult) continue;
  if (flagged(result)) flaggedAnswers += 1;
  if (capped(result)) { cappedAnswers += 1; pointsLost += capCost(result); }
  for (const id of result.judgeResult.criticalContradictions ?? []) caps.contradicted[id] = (caps.contradicted[id] ?? 0) + 1;
  for (const id of result.judgeResult.criticalMisses ?? []) caps.missed[id] = (caps.missed[id] ?? 0) + 1;
}
const counts = (items) => Object.entries(items).sort((a, b) => b[1] - a[1]).map(([id, n]) => `\`${id}\` ${n}`).join(", ");
const capParts = [["contradicted", caps.contradicted], ["missed", caps.missed]]
  .filter(([, items]) => Object.keys(items).length > 0)
  .map(([kind, items]) => `${kind} ${counts(items)}`);
const diagnostics = baseline.results.reduce((totals, result) => {
  for (const key of Object.keys(result.diagnostics ?? {})) totals[key] = (totals[key] ?? 0) + result.diagnostics[key];
  return totals;
}, {});

/** A bullet wrapped at 100 columns, continuation lines indented two spaces, as the doc writes them. */
function bullet(text) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > 100 && line) { lines.push(line); line = `  ${word}`; } else line = next;
  }
  return [...lines, line].join("\n");
}
const lowered = cappedAnswers === 0 ? "none lowered" : `${cappedAnswers} lowered by ${one(pointsLost)} points`;
console.log(bullet(`- **Scores:** total ${one(summary.expectedUserScore)} · integrity ${one(summary.averageIntegrityScore)} · ` +
  `judged ${one(summary.averageSemanticScore)} · completed ${(summary.completionRate * 100).toFixed(1)}% · ` +
  `mean per-task σ ${mean(summary.perTask.map((task) => task.sdTotal)).toFixed(2)}`));
console.log(bullet(flaggedAnswers === 0
  ? `- **Critical caps:** 0 of ${baseline.results.length} answers`
  : `- **Critical caps:** ${flaggedAnswers} of ${baseline.results.length} answers missed or contradicted a critical item, ${lowered}` +
    (capParts.length ? ` (${capParts.join("; ")})` : "")));
console.log(bullet(`- **Diagnostics:** tool argument errors ${diagnostics.toolArgumentErrors} · fallback reports ${diagnostics.fallbackReports} · ` +
  `unverified report figures ${diagnostics.unverifiedFigures} · repaired ${diagnostics.repairedFigures}`));
console.log("");
console.log("| Task | Evidence | Figures | Contracts | Intent | Financial | Grounding | Clarity | Total (σ) | Capped | Run time | Output tokens |");
console.log("| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
console.log(rows.join("\n"));
