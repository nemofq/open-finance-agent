/** Free, read-only audit. Run with `node --import tsx scripts/audit-judge-evidence.ts <run.json|directory>...`. */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeJsonFile } from "../src/lib/atomic-write";
import { auditJudgeEvidence, headCalls, judgeEvidenceOutputs, successfulEvidenceCalls, truncateToolOutput } from "../evals/scoring/judge-evidence";
import { deliveredReportProse } from "../evals/scoring/report-content";

const outcome = z.enum(["served", "empty", "out_of_scope", "not_captured", "not_available_as_of"]);
const callSchema = z.object({
  toolCallId: z.string(), toolName: z.string(), args: z.record(z.string(), z.unknown()), output: z.string(),
  durationMs: z.number(), isError: z.boolean(), details: z.unknown().optional(),
  offlineOutcome: outcome.optional(), sandboxOutcome: outcome.optional(),
}).transform(({ sandboxOutcome, ...call }) => ({ ...call, offlineOutcome: call.offlineOutcome ?? sandboxOutcome }));
const runSchema = z.object({
  benchmarkVersion: z.string().optional(), judgePromptVersion: z.string().optional(),
  results: z.array(z.object({
    task: z.object({ id: z.string() }), agent: z.string(), repeat: z.number(), status: z.string().optional(),
    finalAssistantText: z.string().optional(), toolCalls: z.array(callSchema).optional(),
  })),
});

async function runFiles(input: string): Promise<string[]> {
  if ((await stat(input)).isFile()) return [path.resolve(input)];
  const entries = await readdir(input, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? runFiles(path.join(input, entry.name)) :
    /^run-.*\.json$/.test(entry.name) ? [path.resolve(input, entry.name)] : []));
  return nested.flat().sort();
}

const args = process.argv.slice(2);
const outputAt = args.indexOf("--output");
const output = outputAt < 0 ? undefined : args[outputAt + 1];
if (outputAt >= 0) {
  if (!output || output.startsWith("--")) throw new Error("--output needs a JSON path");
  args.splice(outputAt, 2);
}
if (!args.length) throw new Error("Usage: node --import tsx scripts/audit-judge-evidence.ts [--output audit.json] <run.json|directory>...");
const files = [...new Set((await Promise.all(args.map(runFiles))).flat())];
const seen = new Set<string>();
const counts = { files: files.length, rows: 0, missingTraces: 0, noDeliveredAnswer: 0, duplicateRows: 0, auditedAnswers: 0, affectedAnswers: 0, hiddenFigures: 0, recoveredFigures: 0, windowBudgetMisses: 0, v9Characters: 0, v10Characters: 0 };
const unsupportedFiles: string[] = [];
const byTask: Record<string, { answers: number; affected: number; hidden: number; recovered: number }> = {};
const cases = [];
for (const file of files) {
  const raw: unknown = JSON.parse(await readFile(file, "utf8"));
  const header = z.object({ benchmarkVersion: z.string().optional(), results: z.array(z.unknown()) }).parse(raw);
  // Pre-versioned files stored summaries rather than full output strings; they cannot be audited.
  if (header.benchmarkVersion === undefined) {
    unsupportedFiles.push(file);
    counts.rows += header.results.length;
    counts.missingTraces += header.results.length;
    continue;
  }
  const parsed = runSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid saved run for evidence audit: ${file}`, { cause: parsed.error });
  const run = parsed.data;
  for (const result of run.results) {
    counts.rows++;
    if (!result.toolCalls) { counts.missingTraces++; continue; }
    const report = deliveredReportProse(result.toolCalls);
    const answer = `${result.finalAssistantText ?? ""}\n${report}`;
    if (!answer.trim()) { counts.noDeliveredAnswer++; continue; }
    const identity = createHash("sha256").update(JSON.stringify([result.agent, result.task.id, answer, result.toolCalls])).digest("hex");
    if (seen.has(identity)) { counts.duplicateRows++; continue; }
    seen.add(identity);
    counts.auditedAnswers++;
    const hidden = auditJudgeEvidence(result.toolCalls, answer);
    const recovered = hidden.filter((figure) => figure.recovered).length;
    counts.v9Characters += headCalls(successfulEvidenceCalls(result.toolCalls)).reduce((n, call) => n + truncateToolOutput(call.output).length, 0);
    counts.v10Characters += judgeEvidenceOutputs(result.toolCalls, answer).reduce((n, item) => n + item.output.length, 0);
    const task = byTask[result.task.id] ??= { answers: 0, affected: 0, hidden: 0, recovered: 0 };
    task.answers++;
    if (!hidden.length) continue;
    task.affected++; task.hidden += hidden.length; task.recovered += recovered;
    counts.affectedAnswers++; counts.hiddenFigures += hidden.length; counts.recoveredFigures += recovered;
    counts.windowBudgetMisses += hidden.length - recovered;
    cases.push({ file, task: result.task.id, agent: result.agent, repeat: result.repeat, status: result.status,
      savedBenchmarkVersion: run.benchmarkVersion, savedJudgeVersion: run.judgePromptVersion, hidden });
  }
}
const audit = { note: "Counterfactual v9 versus v10 visibility on saved traces, not a historical misgrading rate. Numeric overlap does not establish entity/metric/period support. Duplicate answers with identical traces are counted once. Reports use the current report decoder.", counts, unsupportedFiles, byTask, cases };
if (output) {
  await writeJsonFile(path.resolve(output), audit);
}
console.log(JSON.stringify({ ...audit, cases: undefined, output }, null, 2));
