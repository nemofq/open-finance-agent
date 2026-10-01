import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent, Usage } from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/utils/retry";
import type { SseEvent } from "@/lib/agent/events";
import type { StoredImage } from "@/lib/attachments/types";
import type { CompactionMessage } from "@/lib/context/types";
import type { Composed } from "@/lib/harness/concern";
import { checkMessage } from "@/lib/policy/summary";
import type { CheckMessage, CheckRecord, PolicyMode } from "@/lib/policy/types";
import { extractCashtags } from "@/lib/sessions/cashtags";
import { DEFAULT_TITLE, heuristicTitle, wantsTitle } from "@/lib/sessions/title";
import type { SessionFile } from "@/lib/sessions/types";
import { applySkillInvocation } from "@/lib/skills/loader";
import type { Skill } from "@/lib/skills/skill";
import { errorMessage } from "@/lib/utils";
import { type Execution, executionDeadline } from "./execution";
import { buildAgent } from "./factory";
import { assistantText, withoutSystemMessages } from "./messages";
import { generateTitle as generateTitleWithModel, writeGeneratedTitle } from "./title";
import { toSseEvents } from "./sse";
import { promptWithTransientRetries } from "./transient-retries";
import type { TurnInput, TurnResult, TurnUsage } from "./turn-types";

/** Run one turn: build the agent, stream events, persist after every message, and summarise. `done` means on disk. */
export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const { config, session, text, skill, scheduled, time, store, wrapTool, keepTool, profileBlock, onAgent } = input;
  const sink = guardSink(input.sink);
  const { images, documents } = input;
  const startedAt = Date.now();
  const checks: CheckRecord[] = [];
  const compactions: CompactionMessage[] = [];
  const usage: TurnUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 };

  const built = await buildAgent({
    config,
    session,
    time,
    skill,
    images,
    documents,
    wrapTool,
    keepTool,
    profileBlock,
    // The deadline runs from the turn's start, so building the agent counts against it.
    execution: { ...input.execution, deadlineAt: executionDeadline(input.execution, startedAt) },
    request: text,
    policyMode: input.policyMode ?? policyModeFromEnv(),
    turn: scheduled ? { kind: "scheduled", taskId: scheduled.taskId } : undefined,
    listeners: {
      onUsage: (contextUsage) => sink?.({ type: "context", usage: contextUsage }),
      onCompaction: (compaction) => {
        compactions.push(compaction);
        sink?.({ type: "message_end", message: compaction });
      },
    },
  });
  const { agent, ledger, composed, execution } = built;
  onAgent?.(agent);
  const knownEvidence = new Set(ledger.list().map((entry) => entry.id));
  let titled = session.title !== DEFAULT_TITLE || session.titleSource !== undefined;

  let writes: Promise<unknown> = Promise.resolve();
  const queueWrite = <T>(job: () => Promise<T>): Promise<T> => {
    const next = writes.then(job, job);
    writes = next.catch(() => undefined);
    return next;
  };

  const persist = () =>
    queueWrite(async () => {
      const messages = withoutSystemMessages(agent.state.messages);
      const patch: Partial<SessionFile> = { messages, timeZone: time.timeZone };
      if (!titled) {
        patch.title = heuristicTitle(skill, text, images, documents);
        patch.titleSource = "heuristic";
        titled = true;
      }
      if (skill) patch.skill = skill;
      return store.update(session.id, patch).then(() => undefined, unsavedReason);
    });

  const model = session.model;
  if ((input.titles ?? true) && model && wantsTitle(session)) {
    const generate = input.generateTitle ?? generateTitleWithModel;
    void writeGeneratedTitle({
      store,
      sessionId: session.id,
      sink,
      queue: queueWrite,
      generate: () => generate({ config, model, sessionId: session.id, text, skill, tickers: extractCashtags(text) }),
    }).catch((err) => console.error("[titles] write failed:", err));
  }

  const drainChecks = () => {
    for (const check of built.turn.checks.slice(checks.length)) {
      checks.push(check);
      sink?.({ type: "check", check });
    }
  };
  let thinking: ThinkingSpan = {};
  let providerRetries = 0, infrastructureError = false;
  const providerRetryErrors: string[] = [];
  const unsubscribe = agent.subscribe(async (event) => {
    drainChecks();
    thinking = stampThinking(thinking, event, Date.now());
    for (const wireEvent of toSseEvents(event)) {
      if (wireEvent.type === "usage") addUsage(usage, wireEvent.usage);
      sink?.(wireEvent);
    }
    if (event.type === "message_end" || event.type === "agent_end") await persist();
  });

  const existing = new Set(agent.state.messages);
  let error: string | undefined;
  try {
    execution.arm(() => agent.abort());
    await composed.beforeTurn(agent.state.messages);
    const prompt = turnPrompt({ text, skill: built.skill, scheduled, images, documents, timestamp: Date.now() });
    // A skill turn goes in as a message, plain text as text; the overloads differ. The benchmark
    // opts into retrying a transiently failed continuation; chat leaves the budget at zero.
    const retry = await promptWithTransientRetries(agent, prompt, {
      maxRetries: input.transientProviderRetries ?? 0,
      baseDelayMs: 1_000,
      signal: input.evalAbortSignal,
    });
    providerRetries += retry.retries;
    providerRetryErrors.push(...retry.errors); infrastructureError ||= retry.infrastructureError;

    execution.stop();
    const recovery = await composed.afterRun(agent.state.messages, () => execution.recovery(agent.state.messages.findLast((m) => m.role === "assistant")));
    if (recovery) execution.arm(() => agent.abort());
    if (recovery?.messages) {
      agent.state.messages = recovery.messages;
      agent.clearAllQueues();
      await agent.continue();
    }
    if (recovery?.prompt) await agent.prompt(recovery.prompt);
    await agent.waitForIdle();
    const answered = assistantText(agent.state.messages.findLast((m) => m.role === "assistant")).trim();
    await composed.afterTurn(agent.state.messages);
    const revised = assistantText(agent.state.messages.findLast((m) => m.role === "assistant")).trim();
    if (revised !== answered) sink?.({ type: "answer_updated", text: revised });
    if (composed.answer.error) throw new Error(composed.answer.error);
  } catch (err) {
    error = errorMessage(err);
  } finally {
    execution.stop();
    unsubscribe();
    drainChecks();
    const checkMessages: CheckMessage[] = checks
      .filter((check) => !(check.kind === "follow_up" && check.enforced))
      .map(checkMessage);
    if (checkMessages.length > 0) agent.state.messages = [...agent.state.messages, ...checkMessages];
    await ledger.flush();
    error ??= await persist(); // the last write lands before `done`, or fails the turn
  }
  sink?.(error ? { type: "error", message: error } : { type: "done" });

  const messages = withoutSystemMessages(agent.state.messages).filter((item) => !existing.has(item));
  const last = messages.findLast((item) => item.role === "assistant");
  if (!input.evalAbortSignal?.aborted && last?.role === "assistant" && isRetryableAssistantError(last)) {
    infrastructureError = true;
  }

  return {
    ...turnOutcome(last, composed.answer, execution, error),
    messages,
    usage,
    evidence: ledger.list().filter((entry) => !knownEvidence.has(entry.id)),
    checks,
    followUps: checks.filter((check) => check.kind === "follow_up" && check.enforced).length,
    compactions,
    durationMs: Date.now() - startedAt,
    ...(providerRetries > 0 ? { providerRetries } : {}),
    ...(infrastructureError ? { infrastructureError: true } : {}),
    ...(providerRetryErrors.length > 0 ? { providerRetryErrors } : {}),
  };
}

/* ------------------------------------------------------------ turn helpers */

/** The reasoning of the assistant message in flight: when it started, and when it last grew. */
export interface ThinkingSpan {
  first?: number;
  last?: number;
}

/**
 * Time the model's reasoning from pi's own events and stamp the total on the finished message.
 * pi emits the object it keeps in `agent.state.messages`, so the stamp is what `persist` writes
 * and what the `message_end` wire event carries — provided it happens before either runs.
 * Pure but for that one stamp: it returns the span to carry into the next event.
 */
export function stampThinking(span: ThinkingSpan, event: AgentEvent, now: number): ThinkingSpan {
  if (event.type === "message_start") return {};
  if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") {
    return { first: span.first ?? now, last: now };
  }
  if (event.type !== "message_end") return span;
  const { first, last } = span;
  if (event.message.role === "assistant" && first !== undefined && last !== undefined) {
    event.message.thinkingMs = last - first;
  }
  return {};
}

function policyModeFromEnv(): PolicyMode {
  return process.env.OFA_POLICY_OBSERVE === "1" ? "observe" : "enforce";
}

function addUsage(total: TurnUsage, usage: Usage | undefined): void {
  if (!usage) return;
  total.input += usage.input;
  total.output += usage.output;
  total.cacheRead += usage.cacheRead;
  total.cacheWrite += usage.cacheWrite;
  total.cost += usage.cost?.total ?? 0;
  total.calls += 1;
}

interface TurnPromptInput extends Pick<TurnInput, "text" | "scheduled" | "images" | "documents"> {
  /** The skill the composer picked, as the factory loaded it; absent when none was, or it is gone. */
  skill?: Skill;
  timestamp: number;
}

/**
 * What a turn hands to `agent.prompt`. A scheduled run is a `scheduled` message and a `/skill` pick
 * a `skill` message, each keeping what was typed apart from the expanded prompt the model receives;
 * a skill turn's attachments sit beside that prompt. A plain message with nothing attached stays a
 * bare string, which is the overload pi has always been given here and the one the transcript
 * already holds; one with attachments becomes a `UserMessage`, text block first, so the model reads
 * the question before the pictures. The images go in as they are stored, with an empty `data`, and
 * the documents as descriptors beside the content; `hydrateAttachments` fills both in on the way to
 * the provider.
 */
export function turnPrompt({ text, skill, scheduled, images, documents, timestamp }: TurnPromptInput): string | AgentMessage {
  const prompt = skill ? applySkillInvocation(text, skill) : text;
  if (scheduled) {
    const { taskId, runId } = scheduled;
    return { role: "scheduled", taskId, runId, request: text, prompt, ...(skill ? { skill: skill.name } : {}), timestamp };
  }
  if (skill) {
    return { role: "skill", skill: skill.name, request: text, prompt, timestamp,
      ...(images?.length ? { images } : {}), ...(documents?.length ? { documents } : {}) };
  }
  if (!images?.length && !documents?.length) return text;
  const blocks: (TextContent | StoredImage)[] = text ? [{ type: "text", text }, ...(images ?? [])] : [...(images ?? [])];
  return { role: "user", content: blocks, ...(documents?.length ? { documents } : {}), timestamp };
}

/**
 * How a finished turn reads. A reply that failed, the budget running out or an answer the harness
 * refused becomes the error when nothing failed before it; a verified answer stands, flagged or
 * failed ones make the turn partial, and a draft alone is kept aside as `draftText`.
 */
function turnOutcome(
  last: AgentMessage | undefined,
  answer: Composed["answer"],
  budget: Pick<Execution, "exhausted" | "stopFor">,
  failure: string | undefined,
): Pick<TurnResult, "status" | "draftText" | "finalText" | "error" | "stop" | "aborted"> {
  let error = failure;
  if (!error && last?.role === "assistant" && last.stopReason === "error") {
    error = last.errorMessage || "The assistant run stopped with an error";
  }
  error ??= budget.exhausted ?? answer.error;
  const stop = budget.stopFor(error);
  const accepted = assistantText(answer.accepted).trim();
  const candidate = assistantText(answer.candidate).trim();
  return {
    status: accepted ? error || answer.flagged ? "partial" : "complete" : candidate ? "partial" : "failed",
    ...(!accepted && candidate ? { draftText: candidate } : {}),
    finalText: accepted || (candidate ? "I could not complete a verified answer. The draft is retained, but its unresolved claims still need validation." : ""),
    error,
    ...(stop ? { stop } : {}),
    ...(last?.role === "assistant" && last.stopReason === "aborted" ? { aborted: true } : {}),
  };
}

/** Delivery is the caller's concern, not the run's: a sink that throws loses its events, never the turn. */
function guardSink(sink?: (event: SseEvent) => void): ((event: SseEvent) => void) | undefined {
  if (!sink) return undefined;
  let failed = false;
  return (event) => {
    try {
      sink(event);
    } catch (err) {
      if (!failed) console.error("[turn] event delivery failed:", err);
      failed = true;
    }
  };
}

/** Log a failed save and return it as the turn's error; never thrown, so it cannot stop the run. */
function unsavedReason(err: unknown): string {
  console.error("[sessions] persist failed:", err);
  return `The chat could not be saved: ${errorMessage(err)}`;
}
