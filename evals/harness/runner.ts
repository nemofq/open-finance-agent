import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SseEvent } from "@/lib/agent/events";
import type { TurnStop } from "@/lib/agent/execution";
import type { TurnUsage } from "@/lib/agent/turn-types";
import type { AppConfig, ModelRef, ThinkingLevel } from "@/lib/config/schema";
import type { EvidenceEntry } from "@/lib/evidence/types";
import { modelRefKey } from "@/lib/llm/catalog";
import { dataDir, withDataDir } from "@/lib/paths";
import type { CheckRecord, PolicyMode } from "@/lib/policy/types";
import { createSession, getSession, updateSession } from "@/lib/sessions/store";
import { type CheckpointIdentity, resumeCheckpoint, writeCheckpoint } from "./checkpoint";
import { runDeterministicChecks } from "../scoring/checks";
import { datasetTaskHash, validateDatasetTasks } from "../offline/dataset";
import { MOCK_MCP_FORMAT_VERSION } from "../offline/mock-mcp-data";
import { countDiagnostics } from "../reporting/diagnostics";
import { analyseEvidence } from "../scoring/evidence";
import { createTaskHome } from "./home";
import { evaluateWithJudge, JUDGE_PROMPT_VERSION } from "../scoring/judge";
import { applyJudgement, awaitsJudgement } from "./rejudge";
import { computeMetrics } from "../reporting/metrics";
import { thinkingTransmitted } from "../models";
import { slug } from "../reporting/report";
import { profilePromptFor, seedUserData } from "./seed";
import { configHash, datasetSummary, headCommit, sumDiagnostics, summariseAgent } from "../reporting/summary";
import { offlineTimeContext, taskTimeContext } from "./task-time";
import { createToolSeam } from "./tool-seam";
import { budgetExhausted, EVAL_TRANSIENT_PROVIDER_RETRIES, hungTurnError, runEvalTurn } from "./turn-bounds";
import {
  BENCHMARK_VERSION,
  type EvalRunSummary,
  type EvalTask,
  type FixtureMode,
  type TaskEvalResult,
  type ToolCallTrace,
  type OfflineAudit,
} from "../types";

/**
 * One benchmark run. Every task goes through `runTurn`, exactly as a chat turn does,
 * with a `TimeContext` built from the task's as-of date and the run's tool seam (`./tool-seam`).
 * Sessions, the profile, the holdings ledger and evidence payloads land in the run's temporary data
 * folder, never the developer's.
 */

export type ProgressEvent =
  | { type: "task_start"; agent: string; task: EvalTask; repeat: number; index: number; total: number }
  | { type: "task_end"; result: TaskEvalResult }
  | { type: "judge_start"; agent: string; task: EvalTask };

export interface RunnerOptions {
  config: AppConfig;
  /** One or more agent models, each graded by the same judge (`--agent a,b,c`). */
  agents: ModelRef[];
  judge: ModelRef;
  /** The judge's reasoning level (`--judge-thinking`); unset sends the judge none, as runs always have. */
  judgeThinking?: ThinkingLevel;
  tasks: EvalTask[];
  repeat: number;
  fixtureMode: FixtureMode;
  /** Where `record` writes its captures; defaults to `evals/fixtures`. */
  captureDir?: string;
  policyMode: PolicyMode;
  /** Atomic JSON checkpoint written after every completed task cell. */
  checkpointPath?: string;
  /** Existing checkpoint to resume; completed cells are skipped. */
  resumePath?: string;
  onProgress?: (event: ProgressEvent) => void;
}

interface TurnTrace {
  toolCalls: ToolCallTrace[];
  finalText: string;
  transcript: AgentMessage[];
  evidence: EvidenceEntry[];
  checks: CheckRecord[];
  followUps: number;
  tickers: string[];
}

/** `details` never reaches the event sink; the persisted tool result carries it. */
function detailsByToolCall(messages: AgentMessage[]): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const message of messages) {
    if (message.role === "toolResult" && message.details !== undefined) map.set(message.toolCallId, message.details);
  }
  return map;
}

export interface RunTaskOptions {
  config: AppConfig;
  task: EvalTask;
  agent: ModelRef;
  judge: ModelRef;
  judgeThinking?: ThinkingLevel;
  repeat: number;
  fixtureMode: FixtureMode;
  captureDir?: string;
  policyMode: PolicyMode;
  onProgress?: (event: ProgressEvent) => void;
}

/** Totals across every turn of one task; multi-turn scenarios pay for every continuation. */
function addUsage(total: TurnUsage, turn: TurnUsage): TurnUsage {
  return {
    input: total.input + turn.input,
    output: total.output + turn.output,
    cacheRead: total.cacheRead + turn.cacheRead,
    cacheWrite: total.cacheWrite + turn.cacheWrite,
    cost: total.cost + turn.cost,
    calls: total.calls + turn.calls,
  };
}

/**
 * Run one task once against one agent model, grade it, and return everything the report needs. It
 * works in the current data folder, which should hold nothing but a config: `runBenchmark` gives
 * every cell a fresh one.
 */
export async function runTask(options: RunTaskOptions): Promise<TaskEvalResult> {
  const { config, task, agent, judge, fixtureMode, policyMode } = options;
  const seam = createToolSeam({
    taskId: task.id,
    mode: fixtureMode,
    asOf: task.asOfDate,
    dir: options.captureDir,
  });

  const session = await createSession({ model: agent });
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  const pending = new Map<string, { name: string; args: Record<string, unknown>; startedAt: number }>();
  const toolCalls: ToolCallTrace[] = [];
  const sink = (event: SseEvent): void => {
    if (event.type === "tool_call_start") {
      const args = typeof event.args === "object" && event.args !== null ? (event.args as Record<string, unknown>) : {};
      pending.set(event.id, { name: event.name, args, startedAt: Date.now() });
      return;
    }
    if (event.type !== "tool_call_end") return;
    const call = pending.get(event.id);
    pending.delete(event.id);
    toolCalls.push({
      toolCallId: event.id,
      toolName: call?.name ?? "unknown",
      args: call?.args ?? {},
      output: event.result,
      durationMs: call ? Date.now() - call.startedAt : 0,
      isError: event.isError,
    });
  };

  let turnError: string | undefined;
  let turnStop: TurnStop | undefined;
  let infrastructureFailure = false;
  let providerRetries = 0;
  const providerRetryErrors: string[] = [];
  let usage: TurnUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 };
  const trace: TurnTrace = {
    toolCalls,
    finalText: "",
    transcript: [],
    evidence: [],
    checks: [],
    followUps: 0,
    tickers: [],
  };

  try {
    await seedUserData(task);
    const turnOptions = {
      config,
      skill: task.skill,
      time: fixtureMode === "offline" ? offlineTimeContext(task) : taskTimeContext(task),
      store: { update: updateSession },
      // A benchmark session is named by its task; no need to spend a call writing a title.
      titles: false,
      sink,
      wrapTool: seam.wrapTool,
      keepTool: seam.keepTool,
      profileBlock: profilePromptFor(task),
      policyMode,
      transientProviderRetries: EVAL_TRANSIENT_PROVIDER_RETRIES,
    };

    const turns = [await seam.run(() => runEvalTurn({ ...turnOptions, session, text: task.prompt }))];
    for (const followUpPrompt of task.followUpPrompts ?? []) {
      const previous = turns[turns.length - 1];
      if (previous.error || previous.aborted) break;
      // Every follow-up continues the same chat, so it starts from the persisted transcript —
      // compaction and all. Its answer is the one that gets graded.
      const continued = await getSession(session.id);
      // No `skill`: a `/skill` invocation belongs to the turn it was typed on, and re-wrapping the
      // follow-up in the whole skill body would hide what the task is measuring.
      turns.push(
        await seam.run(() =>
          runEvalTurn({ ...turnOptions, skill: undefined, session: continued ?? session, text: followUpPrompt }),
        ),
      );
    }

    const graded = turns[turns.length - 1];
    trace.finalText = graded.finalText;
    trace.evidence = turns.flatMap((turn) => turn.evidence);
    trace.checks = turns.flatMap((turn) => turn.checks);
    trace.followUps = turns.reduce((total, turn) => total + turn.followUps, 0);
    const failed = turns.find((turn) => turn.error);
    const aborted = turns.some((turn) => turn.aborted);
    turnError = failed?.error ?? (aborted ? hungTurnError() : undefined);
    turnStop = failed ? failed.stop : aborted ? "deadline" : undefined;
    infrastructureFailure = turns.some((turn) => turn.infrastructureError);
    providerRetries = turns.reduce((total, turn) => total + (turn.providerRetries ?? 0), 0);
    providerRetryErrors.push(...turns.flatMap((turn) => turn.providerRetryErrors ?? []));

    const saved = await getSession(session.id);
    trace.transcript = saved?.messages ?? turns.flatMap((turn) => turn.messages);
    trace.tickers = saved?.tickers ?? [];

    const details = detailsByToolCall(trace.transcript);
    const offlineOutcomes = seam.offlineOutcomes();
    for (const call of toolCalls) {
      const detail = details.get(call.toolCallId);
      if (detail !== undefined) call.details = detail;
      if (offlineOutcomes[call.toolCallId]) call.offlineOutcome = offlineOutcomes[call.toolCallId];
    }

    usage = turns.map((turn) => turn.usage).reduce(addUsage, usage);
  } catch (err) {
    turnError = err instanceof Error ? err.message : String(err);
  } finally {
    const sourceFailures = seam.stats().failures;
    if (fixtureMode === "record" && sourceFailures > 0) {
      turnError ??= `Capture had ${sourceFailures} provider request failure(s); rerun --fixtures record to add what is missing.`;
    }
    // What was captured is kept even when a request failed: a capture only ever adds.
    seam.flush();
    await seam.close();
  }

  const durationMs = Date.now() - started;
  const analysis = await analyseEvidence({
    sessionId: session.id,
    dataDir: dataDir(),
    messages: trace.transcript,
    reported: trace.evidence,
    finalText: trace.finalText,
    toolCalls,
  });

  const deterministicCheck = runDeterministicChecks({
    task,
    toolCalls,
    finalText: trace.finalText,
    sessionTickers: trace.tickers,
    evidence: analysis.entries,
    figureMatches: analysis.figureMatches,
    reportFigureMatches: analysis.reportFigureMatches,
    evidenceAvailable: analysis.available,
  });

  const metrics = computeMetrics({
    evidence: analysis.entries,
    checks: trace.checks,
    figureMatches: analysis.figureMatches,
    evidenceAvailable: analysis.available,
    followUps: trace.followUps,
    usage,
    durationMs,
  });

  const offlineAudit: OfflineAudit | undefined = fixtureMode === "offline" ? seam.offlineAudit() : undefined;
  const offlineIntegrityFailure = Boolean(offlineAudit && offlineAudit.integrityErrors > 0);
  let invalidReason: string | undefined;
  if (offlineIntegrityFailure) {
    invalidReason = `Invalid offline dataset: ${offlineAudit?.integrityErrors} integrity error(s).`;
  } else if (fixtureMode === "record") {
    invalidReason = `Fixture ${fixtureMode} is a data-acquisition run, not a scored benchmark.`;
  }

  // A model timeout, malformed/out-of-scope exploration, or empty answer is a
  // model result, not a broken harness.  A non-empty final answer is judgeable
  // even when the model observed normal closed-world empty/unavailable values.
  // A turn that stopped on its budget but still delivered an answer (the loop spends a reserved
  // request on a bounded final answer) is judged like a completed one; its status stays
  // agent_budget so the stop remains visible.
  const answered = Boolean(trace.finalText.trim());
  const agentFailure = !answered || (Boolean(turnError) && !budgetExhausted(turnStop));
  const status = offlineIntegrityFailure || fixtureMode === "record"
    ? "harness_error"
    : infrastructureFailure
      ? "infra_error"
      : budgetExhausted(turnStop)
        ? "agent_budget"
        : turnStop === "deadline"
          ? "agent_timeout"
          : agentFailure
            ? "agent_error"
            : "completed";
  const valid = status !== "harness_error" && status !== "infra_error";
  const executionError = invalidReason ?? turnError;

  const result: TaskEvalResult = {
    task,
    agent: modelRefKey(agent),
    repeat: options.repeat,
    status,
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs,
    toolCalls,
    evidence: analysis.entries,
    checks: trace.checks,
    figureMatches: analysis.figureMatches,
    ...(analysis.reportFigureMatches.length > 0 ? { reportFigureMatches: analysis.reportFigureMatches } : {}),
    finalAssistantText: trace.finalText,
    sessionTickers: trace.tickers,
    transcript: trace.transcript,
    deterministicCheck,
    ...(valid && agentFailure ? { totalScore: 0 } : {}),
    valid,
    ...(invalidReason ? { invalidReason } : {}),
    metrics,
    diagnostics: countDiagnostics(toolCalls, trace.transcript),
    ...(offlineAudit ? { offlineAudit } : {}),
    ...(providerRetries > 0 ? { providerRetries } : {}),
    ...(providerRetryErrors.length > 0 ? { providerRetryErrors } : {}),
    ...(executionError ? { error: executionError } : {}),
    ...(turnStop ? { stop: turnStop } : {}),
  };

  if (awaitsJudgement(result)) {
    options.onProgress?.({ type: "judge_start", agent: modelRefKey(agent), task });
    applyJudgement(result, await evaluateWithJudge(result, config, judge, options.judgeThinking));
  }

  return result;
}

/** Every agent × task × repeat, in order, so captures and rate limits stay predictable. */
export async function runBenchmark(options: RunnerOptions): Promise<EvalRunSummary> {
  const { config, agents, judge, judgeThinking, tasks, repeat, fixtureMode, policyMode } = options;
  if (fixtureMode === "offline") {
    const issues = validateDatasetTasks(tasks);
    if (issues.length > 0) throw new Error(`Offline dataset preflight failed:\n- ${issues.join("\n- ")}`);
  }
  const commit = headCommit();
  // The run's home; each cell gets a folder of its own inside it.
  const runHome = dataDir();
  const results: TaskEvalResult[] = [];
  const currentTaskHashes = fixtureMode === "offline"
    ? Object.fromEntries(tasks.map((task) => [task.id, datasetTaskHash(task.id) ?? ""]))
    : {};
  const identity: CheckpointIdentity = {
    version: BENCHMARK_VERSION,
    datasetVersion: fixtureMode === "offline" ? MOCK_MCP_FORMAT_VERSION : undefined,
    fixtureMode,
    agents: agents.map(modelRefKey),
    judge: modelRefKey(judge),
    thinking: config.llm.thinkingLevel,
    judgeThinking,
    taskIds: tasks.map((item) => item.id),
    repeat,
    taskDatasetHashes: currentTaskHashes,
  };
  if (options.resumePath) results.push(...resumeCheckpoint(options.resumePath, identity));
  const total = agents.length * tasks.length * repeat;
  let index = 0;

  for (const agent of agents) {
    for (const task of tasks) {
      for (let attempt = 1; attempt <= repeat; attempt++) {
        const key = `${modelRefKey(agent)}:${task.id}:${attempt}`;
        const checkpointed = results.find((existing) => `${existing.agent}:${existing.task.id}:${existing.repeat}` === key);
        // A completed/model-error cell is durable benchmark output.  Harness
        // and judge errors are retried on resume because the environment or
        // contract may have been repaired after the checkpoint was written.
        if (checkpointed && checkpointed.status !== "harness_error" && checkpointed.status !== "judge_error") continue;
        if (checkpointed) {
          const indexToReplace = results.indexOf(checkpointed);
          results.splice(indexToReplace, 1);
        }
        index += 1;
        options.onProgress?.({ type: "task_start", agent: modelRefKey(agent), task, repeat: attempt, index, total });
        // A task must never inherit another task's profile, holdings, memory or chats.
        const taskHome = createTaskHome(runHome, `${slug(modelRefKey(agent))}-${task.id}-${attempt}`);
        const result = await withDataDir(taskHome, () => runTask({
          config,
          task,
          agent,
          judge,
          judgeThinking,
          repeat: attempt,
          fixtureMode,
          captureDir: options.captureDir,
          policyMode,
          onProgress: options.onProgress,
        }));
        results.push(result);
        options.onProgress?.({ type: "task_end", result });
        if (options.checkpointPath) writeCheckpoint(options.checkpointPath, { ...identity, results });
      }
    }
  }

  const dataset = fixtureMode === "offline" ? datasetSummary(MOCK_MCP_FORMAT_VERSION, currentTaskHashes, results) : undefined;

  return {
    timestamp: new Date().toISOString(),
    benchmarkVersion: BENCHMARK_VERSION,
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    agents: agents.map(modelRefKey),
    judge: modelRefKey(judge),
    thinking: config.llm.thinkingLevel,
    thinkingTransmitted: await thinkingTransmitted(config, agents, config.llm.thinkingLevel),
    ...(judgeThinking ? { judgeThinking, judgeThinkingTransmitted: await thinkingTransmitted(config, [judge], judgeThinking) } : {}),
    ...(dataset ? { dataset } : {}),
    fixtureMode,
    policyMode,
    configHash: configHash(config),
    ...(commit ? { commit } : {}),
    repeat,
    taskIds: tasks.map((task) => task.id),
    agentSummaries: agents.map((agent) => summariseAgent(agent, judge, tasks, results)),
    diagnostics: sumDiagnostics(results),
    results,
  };
}
