import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIMITS } from "@/lib/agent/execution";
import { type AppConfig, type ModelRef, type ThinkingLevel, thinkingLevels } from "@/lib/config/schema";
import { clearProviderEnv } from "@/lib/llm/ambient-env";
import { sameModelRef } from "@/lib/llm/catalog";
import { createTempHome } from "./harness/home";
import { resolveModelSpec } from "./models";
import { baselineRefusal, benchmarkValidityIssues, type RunFiles, scoreLine, suggestBaselineName, writeBaseline, writeRunFiles } from "./reporting/report";
import type { ProgressEvent } from "./harness/runner";
import { RETAIL_EVAL_TASKS } from "./tasks";
import { type EvalRunSummary, type EvalTask, type FixtureMode, type TaskEvalResult } from "./types";

/**
 * The benchmark's only entry point: developer-only, CLI-only, never part
 * of `pnpm test`. Both models are named on every run, and every run works in a throwaway data
 * folder, so a benchmark can never touch the developer's chats.
 *
 * `--help` and `--list` answer without loading the agent runtime, so they work anywhere; the
 * runner, the config store and the provider catalogue are imported only once a run is really
 * starting.
 */

const FIXTURE_MODES: FixtureMode[] = ["offline", "live", "record"];

export interface CliOptions {
  help: boolean;
  list: boolean;
  listModels: boolean;
  /** `provider/model` specs; several agents share one judge. */
  agents: string[];
  judge?: string;
  taskIds: string[];
  repeat: number;
  judgeRepeat: number;
  fixtures: FixtureMode;
  /** `config.json` to copy into the run's temporary home; defaults to the developer's. */
  configPath?: string;
  outDir?: string;
  observe: boolean;
  keep: boolean;
  baseline?: string;
  checkpointPath?: string;
  resumePath?: string;
  judgeOnly?: string;
  rescore?: string;
  compare?: string;
  thinking?: ThinkingLevel;
  /** The judge's reasoning level; unset sends the judge none, as every run before the flag did. */
  judgeThinking?: ThinkingLevel;
}

export type ParseResult = { ok: true; options: CliOptions } | { ok: false; error: string };

const USAGE = `Open Finance Agent — developer benchmark

Usage:
  pnpm eval --agent <provider/model> --judge <provider/model> [options]
  npx tsx evals/cli.ts --agent <provider/model> --judge <provider/model> [options]

Required for a run:
  --agent <spec[,spec…]>   Agent model(s); each is graded by the same judge
  --judge <spec>           Judge model. The same model as the agent is marked "self-judged"

Options:
  --task <id>              Run one task; repeatable, or a comma-separated list
  --repeat <n>             Repeat each task n times to measure noise (default 1)
  --judge-repeat <n>       Independent item-level judge votes per answer (default 1; baseline 3)
  --fixtures <mode>        offline | live | record (default offline). live runs against the
                           real providers and is not comparable; record is the maintainer's
                           capture step and adds provider responses to evals/fixtures/<task>.json
  --thinking <level>       off | minimal | low | medium | high | xhigh | max, pi-ai's levels,
                           clamped to what each agent model accepts (default: config setting)
  --judge-thinking <level> The same levels, for the judge (default: none sent, as before);
                           --judge-only reuses the level the run recorded
  --config <path>          config.json to copy into the run; sign-ins use the auth.json
                           beside it in place (default: your data folder)
  --out <dir>              Where results go (default evals/results/)
  --baseline <name>        Also write the run's summary to evals/baselines/<name>.json; refused
                           unless repeat=3+, judge-repeat=3+, and the run is valid
  --checkpoint <path>      Checkpoint written after every task cell (default for an offline run:
                           offline-eval-checkpoint.json in the --out folder)
  --resume <path>          Resume completed cells from a checkpoint JSON
  --judge-only <path>      Finish a saved run JSON: judge the results whose judgement is missing
                           or failed, with the run's own judge (no --judge); takes --baseline
  --rescore <run.json>     Recompute v2 integrity and judge scores from a saved run's traces;
                           writes a new run and never overwrites the source
  --compare <baseline>     Compare the resulting run with a baseline using paired bootstrap
  --observe                Run the enforcement rules in observe mode
  --keep                   Keep the temporary data folder for inspection
  --list                   List the benchmark tasks
  --list-models            List the models the configured providers offer
  --help                   Show this message

A model spec is "provider/model". Provider ids never contain a slash, so everything after the
first one is the model id: local/Qwen/Qwen3-32B is the model Qwen/Qwen3-32B.

Exit code is non-zero for harness errors, for an offline run with an invalid result and for a record
run whose capture failed, never for a low score.`;

function isThinkingLevel(value: string | null): value is ThinkingLevel {
  return value !== null && (thinkingLevels as readonly string[]).includes(value);
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

export function parseArgs(argv: string[]): ParseResult {
  const options: CliOptions = {
    help: false,
    list: false,
    listModels: false,
    agents: [],
    taskIds: [],
    repeat: 1,
    judgeRepeat: 1,
    // The committed offline dataset is the only scored mode, and the only one that needs no
    // provider keys besides the two models.
    fixtures: "offline",
    observe: false,
    keep: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    /** The value that follows a flag, or null when the flag was given without one. */
    const needsValue = (): string | null => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) return null;
      index += 1;
      return next;
    };

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--list":
        options.list = true;
        break;
      case "--list-models":
        options.listModels = true;
        break;
      case "--observe":
        options.observe = true;
        break;
      case "--keep":
        options.keep = true;
        break;
      case "--agent": {
        const value = needsValue();
        if (!value) return { ok: false, error: "--agent needs a provider/model spec." };
        options.agents.push(...splitList(value));
        break;
      }
      case "--judge": {
        const value = needsValue();
        if (!value) return { ok: false, error: "--judge needs a provider/model spec." };
        options.judge = value;
        break;
      }
      case "--task": {
        const value = needsValue();
        if (!value) return { ok: false, error: "--task needs a task id." };
        options.taskIds.push(...splitList(value));
        break;
      }
      case "--repeat": {
        const value = needsValue();
        const repeat = Number(value);
        if (!value || !Number.isInteger(repeat) || repeat < 1) return { ok: false, error: "--repeat needs a positive integer." };
        options.repeat = repeat;
        break;
      }
      case "--judge-repeat": {
        const value = needsValue();
        const repeat = Number(value);
        if (!value || !Number.isInteger(repeat) || repeat < 1) return { ok: false, error: "--judge-repeat needs a positive integer." };
        options.judgeRepeat = repeat;
        break;
      }
      case "--fixtures": {
        const value = needsValue();
        if (!value || !FIXTURE_MODES.includes(value as FixtureMode)) {
          return { ok: false, error: `--fixtures must be one of ${FIXTURE_MODES.join(", ")}.` };
        }
        options.fixtures = value as FixtureMode;
        break;
      }
      case "--config": {
        const value = needsValue();
        if (!value) return { ok: false, error: "--config needs a path to a config.json." };
        options.configPath = value;
        break;
      }
      case "--out": {
        const value = needsValue();
        if (!value) return { ok: false, error: "--out needs a directory." };
        options.outDir = value;
        break;
      }
      case "--baseline": {
        const value = needsValue();
        if (!value) return { ok: false, error: "--baseline needs a name, e.g. 2026-09-20-local-qwen-qwen3-32b-openrouter-openai-gpt-5." };
        options.baseline = value;
        break;
      }
      case "--checkpoint": {
        const value = needsValue();
        if (!value) return { ok: false, error: "--checkpoint needs a path." };
        options.checkpointPath = value;
        break;
      }
      case "--resume": {
        const value = needsValue();
        if (!value) return { ok: false, error: "--resume needs a checkpoint path." };
        options.resumePath = value;
        break;
      }
      case "--judge-only": {
        const value = needsValue();
        if (!value) return { ok: false, error: "--judge-only needs a run JSON path." };
        options.judgeOnly = value;
        break;
      }
      case "--rescore": {
        const value = needsValue();
        if (!value) return { ok: false, error: "--rescore needs a run JSON path." };
        options.rescore = value;
        break;
      }
      case "--compare": {
        const value = needsValue();
        if (!value) return { ok: false, error: "--compare needs a baseline JSON path." };
        options.compare = value;
        break;
      }
      case "--thinking":
      case "--judge-thinking": {
        const value = needsValue();
        if (!isThinkingLevel(value)) return { ok: false, error: `${arg} must be one of ${thinkingLevels.join(", ")}.` };
        if (arg === "--thinking") options.thinking = value;
        // Off sends the judge nothing, as no flag does, so it is recorded as no flag: a resume or a
        // summary cannot tell the two apart because the wire cannot.
        else if (value !== "off") options.judgeThinking = value;
        break;
      }
      default:
        return { ok: false, error: `Unknown argument “${arg}”. Run with --help.` };
    }
  }

  if (options.judgeOnly && options.judge) return { ok: false, error: "--judge-only grades with the judge the run was graded by; leave out --judge." };
  if (options.judgeOnly && options.judgeThinking) {
    return { ok: false, error: "--judge-only grades at the judge thinking the run recorded; leave out --judge-thinking." };
  }
  if (options.rescore && options.judge) return { ok: false, error: "--rescore grades with the judge recorded in the run; leave out --judge." };
  if (options.judgeOnly && options.rescore) return { ok: false, error: "Use only one of --judge-only and --rescore." };
  if ((options.judgeOnly || options.rescore) && options.agents.length > 0) {
    return { ok: false, error: "Saved-run modes use the agents recorded in the file; leave out --agent." };
  }
  return { ok: true, options };
}

/**
 * `--baseline` on a run that could never be promoted — not offline, self-judged, or a single
 * repeat — is refused before any agent runs, with the reason. `--judge-only` checks the saved run
 * instead, in `judgeOnly`.
 */
export function baselinePreflight(options: CliOptions, agents: ModelRef[], judge: ModelRef): string | undefined {
  if (!options.baseline) return undefined;
  if (options.fixtures !== "offline") return `--baseline refuses this run: fixture mode ${options.fixtures} is not the offline dataset.`;
  return baselineRefusal({ repeat: options.repeat, judgeRepeat: options.judgeRepeat, selfJudged: agents.some((agent) => sameModelRef(agent, judge)) });
}

export type JudgeOnlyOutcome =
  | { ok: false; error: string }
  | { ok: true; summary: EvalRunSummary; files: RunFiles; baselinePath?: string };

/**
 * `--judge-only`: finish judging a saved run with the judge it was graded by, so every result keeps
 * one judge, and write it out again, promoting it with `--baseline`. Refused before any judge call
 * when the run's judge is not configured or the run could never be a baseline.
 */
export async function judgeOnly(input: {
  saved: EvalRunSummary;
  config: AppConfig;
  baseline?: string;
  outDir: string;
  baselineDir: string;
}): Promise<JudgeOnlyOutcome> {
  const { saved } = input;
  if (saved.results.some((result) => !result.diagnostics)) {
    return { ok: false, error: "--judge-only cannot finish this run: it was written before results recorded their diagnostics. Run the benchmark again." };
  }
  const judge = resolveModelSpec(input.config, saved.judge);
  if (!judge.ok) return { ok: false, error: judge.error };
  const refusal = input.baseline ? baselineRefusal({ repeat: saved.repeat, judgeRepeat: saved.judgeRepeat, selfJudged: saved.agentSummaries.some((agent) => agent.selfJudged) }) : undefined;
  if (refusal) return { ok: false, error: refusal };
  const { judgeRun } = await import("./harness/rejudge");
  const summary = await judgeRun(saved, input.config, judge.ref);
  const files = writeRunFiles(summary, input.outDir);
  if (!input.baseline) return { ok: true, summary, files };
  const issues = benchmarkValidityIssues(summary, { baseline: true });
  if (issues.length > 0) return { ok: false, error: `Rejudged run written to ${files.jsonPath}, but not promoted: ${issues.join("; ")}` };
  return { ok: true, summary, files, baselinePath: writeBaseline(summary, input.baseline, input.baselineDir) };
}

/** Tasks left after `--task`; an id that matches nothing is an error. */
export function selectTasks(options: CliOptions, all: EvalTask[] = RETAIL_EVAL_TASKS): { ok: true; tasks: EvalTask[] } | { ok: false; error: string } {
  if (options.taskIds.length === 0) return { ok: true, tasks: all };

  const unknownTask = options.taskIds.find((id) => !all.some((task) => task.id === id));
  if (unknownTask) return { ok: false, error: `Unknown task “${unknownTask}”. Run --list to see the ids.` };

  return { ok: true, tasks: all.filter((task) => options.taskIds.includes(task.id)) };
}

function listTasks(): void {
  console.log(`\n${RETAIL_EVAL_TASKS.length} benchmark tasks:\n`);
  for (const task of RETAIL_EVAL_TASKS) {
    console.log(`  ${task.id}`);
    console.log(`    ${task.title} · ${task.category} · as-of ${task.asOfDate}${task.requiresMathCalculation ? " · math" : ""}`);
    console.log(`    "${task.prompt}"\n`);
  }
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width);
}

function printFinalTable(results: TaskEvalResult[]): void {
  console.log(`\n${pad("Task", 34)} ${pad("Agent", 26)} ${pad("Integrity", 10)} ${pad("Semantic", 9)} ${pad("Total", 6)}`);
  console.log("-".repeat(84));
  for (const result of results) {
    console.log(
      `${pad(result.task.title, 34)} ${pad(result.agent, 26)} ${pad(`${result.deterministicCheck.score}/40`, 10)} ` +
        `${pad(result.judgeResult ? `${result.judgeResult.totalJudgeScore}/60` : "N/A", 9)} ${pad(result.totalScore === undefined ? "INVALID" : `${result.totalScore}`, 6)}`,
    );
  }
}

function progress(event: ProgressEvent): void {
  if (event.type === "task_start") {
    console.log(`\n[${event.index}/${event.total}] ${event.agent} · ${event.task.title}${event.repeat > 1 ? ` (run ${event.repeat})` : ""}`);
    return;
  }
  if (event.type === "judge_start") {
    console.log(`  judging…`);
    return;
  }
  const { result } = event;
  const audit = result.offlineAudit;
  const score = result.totalScore === undefined
    ? "unscored"
    : `integrity ${result.deterministicCheck.score}/40 · semantic ${result.judgeResult ? `${result.judgeResult.totalJudgeScore}/60` : "N/A"} · expected ${result.totalScore}/100`;
  const { diagnostics } = result;
  console.log(
    `  ${score} · ${result.status} · ${result.metrics.modelCalls} model calls · ${result.metrics.tokens.output} output tokens · ` +
      `${result.toolCalls.length} tool calls · ${(result.durationMs / 1000).toFixed(1)}s wall clock` +
      ` · tool-arg errors ${diagnostics.toolArgumentErrors} / fallback reports ${diagnostics.fallbackReports} / unverified ${diagnostics.unverifiedFigures} / repaired ${diagnostics.repairedFigures}` +
      (audit ? ` · offline corpus-not-captured ${audit.corpusNotCaptured} / empty ${audit.emptyProviderResults} / out-of-scope ${audit.outOfScopeQueries} / future ${audit.notAvailableAsOf} / integrity ${audit.integrityErrors}` : ""),
  );
  if (result.invalidReason) console.log(`  ⛔ ${result.invalidReason}`);
  if (result.error) console.log(`  ⚠️  ${result.error}`);
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`${parsed.error}\n`);
    return 1;
  }
  const { options } = parsed;

  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.list) {
    listTasks();
    return 0;
  }

  const outDir = options.outDir
    ? path.resolve(process.cwd(), options.outDir)
    : fileURLToPath(new URL("results/", import.meta.url));
  const baselineDir = fileURLToPath(new URL("baselines/", import.meta.url));

  const { readConfig } = await import("@/lib/config/store");
  const { configPath: defaultConfigPath } = await import("@/lib/paths");
  const source = options.configPath ? path.resolve(process.cwd(), options.configPath) : defaultConfigPath();

  // Everything below runs against the temporary home: `dataDir()` reads OFA_HOME on every call.
  const home = createTempHome(source);
  try {
    const config = readConfig();
    if (options.thinking) {
      config.llm.thinkingLevel = options.thinking;
    }

    if (options.listModels) {
      const { listProviderModels } = await import("@/lib/llm");
      for (const provider of await listProviderModels(config)) {
        console.log(`\n${provider.provider} (${provider.type})${provider.error ? ` — ${provider.error}` : ""}`);
        for (const model of provider.models) console.log(`  ${provider.provider}/${model.id}`);
      }
      return 0;
    }

    if (options.judgeOnly) {
      const saved = JSON.parse(readFileSync(path.resolve(process.cwd(), options.judgeOnly), "utf8")) as EvalRunSummary;
      const outcome = await judgeOnly({ saved, config, baseline: options.baseline, outDir, baselineDir });
      if (!outcome.ok) {
        console.error(`${outcome.error}\n`);
        return 1;
      }
      console.log(`Rejudged run: ${outcome.files.jsonPath}\nSummary: ${outcome.files.mdPath}`);
      if (outcome.baselinePath) console.log(`Baseline: ${outcome.baselinePath}`);
      if (options.compare) {
        const baseline = JSON.parse(readFileSync(path.resolve(process.cwd(), options.compare), "utf8")) as EvalRunSummary;
        const { compareRuns, renderComparison } = await import("./reporting/compare");
        console.log(`\n${renderComparison(compareRuns(outcome.summary, baseline))}`);
      }
      return benchmarkValidityIssues(outcome.summary).length > 0 ? 1 : 0;
    }

    if (options.rescore) {
      const sourcePath = path.resolve(process.cwd(), options.rescore);
      const saved = JSON.parse(readFileSync(sourcePath, "utf8")) as EvalRunSummary;
      const judge = resolveModelSpec(config, saved.judge);
      if (!judge.ok) {
        console.error(`${judge.error}\n`);
        return 1;
      }
      const { rescoreRun } = await import("./harness/rescore");
      const summary = await rescoreRun(saved, config, judge.ref, options.judgeRepeat);
      const files = writeRunFiles(summary, outDir);
      printFinalTable(summary.results);
      console.log(`\nRescored v${summary.benchmarkVersion} run: ${files.jsonPath}\nSummary: ${files.mdPath}`);
      if (options.baseline) console.log(`Baseline: ${writeBaseline(summary, options.baseline, baselineDir)}`);
      if (options.compare) {
        const baseline = JSON.parse(readFileSync(path.resolve(process.cwd(), options.compare), "utf8")) as EvalRunSummary;
        const { compareRuns, renderComparison } = await import("./reporting/compare");
        console.log(`\n${renderComparison(compareRuns(summary, baseline))}`);
      }
      return benchmarkValidityIssues(summary).length > 0 ? 1 : 0;
    }

    if (!options.judge || options.agents.length === 0) {
      console.error("Both --agent and --judge are required. Run --list-models to see what is configured, or --help.\n");
      return 1;
    }

    const agents: ModelRef[] = [];
    for (const spec of options.agents) {
      const resolved = resolveModelSpec(config, spec);
      if (!resolved.ok) {
        console.error(`${resolved.error}\n`);
        return 1;
      }
      agents.push(resolved.ref);
    }
    const judge = resolveModelSpec(config, options.judge);
    if (!judge.ok) {
      console.error(`${judge.error}\n`);
      return 1;
    }

    // Refuse before spending a run that could never be promoted.
    {
      const refusal = baselinePreflight(options, agents, judge.ref);
      if (refusal) {
        console.error(`${refusal}\n`);
        return 1;
      }
    }

    const selected = selectTasks(options);
    if (!selected.ok) {
      console.error(`${selected.error}\n`);
      return 1;
    }

    const policyMode = options.observe ? "observe" : "enforce";
    console.log(
      `Agents: ${options.agents.join(", ")}\nJudge: ${options.judge}${options.judgeThinking ? ` · thinking ${options.judgeThinking}` : ""}\n` +
        `Tasks: ${selected.tasks.length} × ${options.repeat} · Fixtures: ${options.fixtures} · Policy: ${policyMode}\n` +
        `Turn budget: ${LIMITS.calls} model calls · ${LIMITS.turnMs / 60_000}m deadline\n` +
        `Data folder: ${home.dir}`,
    );

    const { runBenchmark } = await import("./harness/runner");
    const checkpointPath = options.checkpointPath
      ? path.resolve(process.cwd(), options.checkpointPath)
      : options.fixtures === "offline"
        ? path.join(outDir, "offline-eval-checkpoint.json")
        : undefined;
    const summary = await runBenchmark({
      config,
      agents,
      judge: judge.ref,
      judgeThinking: options.judgeThinking,
      judgeRepeat: options.judgeRepeat,
      tasks: selected.tasks,
      repeat: options.repeat,
      fixtureMode: options.fixtures,
      policyMode,
      checkpointPath,
      resumePath: options.resumePath ? path.resolve(process.cwd(), options.resumePath) : undefined,
      onProgress: progress,
    });
    const files = writeRunFiles(summary, outDir);
    printFinalTable(summary.results);
    for (const agent of summary.agentSummaries) {
      console.log(
        `\n${agent.agent}: ${scoreLine(agent, summary.repeat)}` +
          ` · tool-arg errors ${agent.diagnostics.toolArgumentErrors} / fallback reports ${agent.diagnostics.fallbackReports}` +
          ` / unverified ${agent.diagnostics.unverifiedFigures} / repaired ${agent.diagnostics.repairedFigures}`,
      );
    }
    console.log(`\nRun:     ${files.jsonPath}`);
    console.log(`Summary: ${files.mdPath}`);

    if (options.compare) {
      const baseline = JSON.parse(readFileSync(path.resolve(process.cwd(), options.compare), "utf8")) as EvalRunSummary;
      const { compareRuns, renderComparison } = await import("./reporting/compare");
      console.log(`\n${renderComparison(compareRuns(summary, baseline))}`);
    }

    const validityIssues = benchmarkValidityIssues(summary);
    if (options.baseline) {
      console.log(`Baseline: ${writeBaseline(summary, options.baseline, baselineDir)}`);
    } else if (validityIssues.length === 0) {
      const refusal = baselineRefusal({ repeat: summary.repeat, judgeRepeat: summary.judgeRepeat, selfJudged: summary.agentSummaries.some((agent) => agent.selfJudged) });
      console.log(refusal ? `Not baseline-eligible: ${refusal.replace(/^--baseline refuses this run: /, "")}` : `Promote this run with --baseline ${suggestBaselineName(summary)}`);
    }
    if (options.keep) console.log(`Kept the run's data folder at ${home.dir}`);
    const captureFailed = options.fixtures === "record" && summary.results.some((result) => Boolean(result.error));
    return (options.fixtures === "offline" && validityIssues.length > 0) || captureFailed ? 1 : 0;
  } finally {
    if (options.keep) home.keep();
    else home.remove();
  }
}

/** Importing this module (the unit tests do) must not start a run. */
const runDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (runDirectly) {
  // As the server does at startup, so a benchmark sends what the app would.
  clearProviderEnv();
  main()
    .then((code) => {
      // Provider SDKs may leave keep-alive handles after the run is fully
      // persisted.  The direct benchmark CLI owns the process, so terminate
      // after main has written JSON/Markdown/checkpoint artifacts instead of
      // making CI wait for unrelated client handles.
      process.exit(code);
    })
    .catch((err: unknown) => {
      console.error(`\n[benchmark] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      process.exitCode = 1;
    });
}
