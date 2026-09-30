import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/utils/retry";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AppConfig } from "@/lib/config/schema";
import { evidenceOf } from "@/lib/evidence/ids";
import { contentHash } from "@/lib/evidence/hash";
import { isEvidenceRead } from "@/lib/evidence/tool";
import type { ToolCall, ToolOutcome, TurnState } from "@/lib/harness/concern";
import type { Block } from "@/lib/policy/types";
import { hasToolProtocol } from "@/lib/llm/answer";
import { streamModel } from "@/lib/llm/stream";
import { blockText } from "@/lib/text/blocks";
import { NO_USAGE } from "./messages";

/**
 * Why a turn was stopped before it finished on its own: its model-call limit, its deadline,
 * research rounds that found nothing new, or research rounds whose tools kept failing.
 */
export type TurnStop = "calls" | "deadline" | "stalled" | "tool_failures";

export interface ExecutionLimits { turnMs: number; requestMs: number; recoveryMs: number; calls: number; stalledCalls: number; failedCalls: number }
export type ExecutionOptions = Partial<ExecutionLimits> & { deadlineAt?: number };
export const LIMITS: ExecutionLimits = { turnMs: 720_000, requestMs: 240_000, recoveryMs: 90_000, calls: 32, stalledCalls: 6, failedCalls: 10 };
/** Anchor the budget at the caller's turn boundary, including setup and compaction. */
export const executionDeadline = (options: ExecutionOptions = {}, now = Date.now()) =>
  Math.min(options.deadlineAt ?? Infinity, now + (options.turnMs ?? LIMITS.turnMs));
type Phase = "analysis" | "repair" | "final" | "recovery";
const OUTPUT: Record<Phase, number> = { analysis: 24_576, repair: 12_288, final: 4_096, recovery: 8_192 };
/** One tool failing this many times running is not going to succeed by being called again. */
const REPEATED = 3;
const INPUT_ERROR = /\b(?:invalid|malformed|validation failed|json|arguments?|parameters?)\b/i;
/** A model that declares reasoning spends part of each request thinking before it answers. */
const THINKING = 1.5;
/** pi's Gemini and Vertex adapters refuse any fetch but the global one. */
const GLOBAL_FETCH_ONLY: ReadonlySet<Api> = new Set<Api>(["google-generative-ai", "google-vertex"]);
const CLOSE = "No more tools are available; write plain prose, never tool-call markup. Do not repeat an unsupported claim from a prior draft. If a report was already created, give only its short summary.";
/** An interrupted request still has its answer to give, so it gives it briefly. */
const INTERRUPTED = `Answer the latest user request now from the evidence already gathered, preserving its scope and staying under 400 words. ${CLOSE} Keep only verified claims with their evidence ids; state what remains unavailable.`;
/** Research that stopped early makes the gap part of the answer, which needs room to explain. */
const CUT_SHORT = `Research ended before it was complete. Answer the latest user request from the evidence already gathered, preserving its scope and staying under 800 words. ${CLOSE} Keep only verified claims with their evidence ids, and name what could not be retrieved and how that limits the answer.`;
export interface RequestTrace {
  phase: Phase;
  startedAt: number;
  endedAt?: number;
  status?: number;
  error?: { name: string; message: string; code?: string };
  input?: number;
  output?: number;
}

function failure(err: unknown): NonNullable<RequestTrace["error"]> {
  const error = err instanceof Error ? err : new Error(String(err));
  const cause = error.cause instanceof Error ? error.cause : error;
  const code = (cause as Error & { code?: unknown }).code;
  return { name: error.name, message: cause.message, ...(typeof code === "string" ? { code } : {}) };
}

/** One budget around SDK requests; the SDK still owns the agent loop and transport retries. */
export function execution(config: AppConfig, turn: TurnState, overrides: ExecutionOptions = {}) {
  const limits = { ...LIMITS, ...overrides };
  // `runTurn` anchors the deadline at the turn's start; a caller that did not gets one from now.
  const deadline = overrides.deadlineAt ?? executionDeadline(overrides);
  const reserve = Math.min(limits.recoveryMs, Math.max(0, deadline - Date.now()) / 3);
  const requests: RequestTrace[] = [];
  const seen = new Set(turn.ledger.list().map((entry) => entry.hash ?? entry.id));
  let attempted = false, progressed = false, succeeded = false, stalled = 0, failed = 0;
  let recovering = false, cutShort = false;
  let recoveryCalls = 0;
  // Consecutive error results per tool, whether the tool's current streak is input errors only,
  // and the tools that failed since research last progressed (named when research stops).
  const errors = new Map<string, number>(), rejected = new Map<string, boolean>(), failing = new Set<string>();
  let exhausted: string | undefined;
  // What each stop message means, so a caller can classify the turn's error without reading its
  // words. The reserved completion running out is not listed: it is not a budget of its own.
  const stops = new Map<string, TurnStop>();
  const exhaust = (message: string, stop: TurnStop): string => {
    stops.set(message, stop);
    exhausted = message;
    return message;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A correction arrives as a user message; it still needs repair reasoning after report creation.
  const phase = (context: Context): Phase => recovering ? "recovery"
    : turn.delivery?.stage === "created" && context.messages.at(-1)?.role === "user" ? "repair"
    : turn.delivery?.stage === "created" || turn.delivery?.mode === "chat" ? "final" : "analysis";
  const stop = () => { clearTimeout(timer); };
  const capped = (name: string): Block | undefined => (errors.get(name) ?? 0) < REPEATED ? undefined
    : { block: true, reason: `${name} failed ${REPEATED} times in a row with the same kind of error; finish from what you have` };
  return {
    requests,
    stop,
    beforeTool(call: ToolCall): Block | undefined {
      if (recovering) return { block: true, reason: "Recovery must finish from existing evidence without executing more tools." };
      if (exhausted) return { block: true, reason: exhausted };
      return capped(call.name);
    },
    /** Arguments are prepared and validated before beforeTool runs, so a capped tool is stopped there too. */
    guard: (tool: AgentTool): AgentTool => ({ ...tool, prepareArguments: (args: unknown) => {
      const block = capped(tool.name);
      if (block) throw new Error(block.reason);
      return tool.prepareArguments ? tool.prepareArguments(args) : args;
    } }),
    toolResult(call: ToolCall, result: ToolOutcome) {
      if (call.tool?.meta.effect === "write-local") return;
      attempted = true;
      const count = errors.get(call.name) ?? 0;
      if (result.isError) {
        failing.add(call.name);
        if (count >= REPEATED) return; // a blocked call says nothing new about the tool
        const text = blockText(result.content, "\n");
        errors.set(call.name, count + 1);
        rejected.set(call.name, (count === 0 || rejected.get(call.name) === true) && INPUT_ERROR.test(text));
        return;
      }
      errors.delete(call.name);
      succeeded = true;
      // Rereading an entry counts only when it shows content the turn has not seen yet.
      const reread = isEvidenceRead(result.details) ? turn.ledger.get(result.details.id) : undefined;
      for (const entry of reread ? [reread] : evidenceOf(result.details)) {
        const key = reread ? contentHash(result.content) : entry.hash ?? entry.id;
        if (entry.lookAhead || seen.has(key) || entry.kind === "A" || entry.kind === "R") continue;
        if (typeof entry.value !== "number" && !entry.facts?.length && !entry.table?.rows.length && !entry.hasPayload) continue;
        seen.add(key);
        progressed = true;
      }
    },
    get exhausted() { return exhausted; },
    /** The typed reason behind `error` when it is one of this budget's stop messages. */
    stopFor(error: string | undefined): TurnStop | undefined { return error === undefined ? undefined : stops.get(error); },
    arm(abort: () => void) {
      stop();
      const remaining = deadline - Date.now() - (recovering ? 0 : reserve);
      timer = setTimeout(() => { exhaust("The turn reached its execution deadline", "deadline"); abort(); }, Math.max(1, remaining));
      timer.unref?.();
    },
    recovery(last: AssistantMessage | undefined) {
      if (recovering || Date.now() >= deadline || !last) return undefined;
      if (last.stopReason === "aborted" && !exhausted) return undefined;
      const malformed = hasToolProtocol(blockText(last.content, "\n"));
      // pi's classifier knows the transient provider errors; a request that hit its own deadline is one too.
      const retryable = exhausted || malformed || last.stopReason === "length" || isRetryableAssistantError(last) ||
        (last.stopReason === "error" && /deadline/i.test(last.errorMessage ?? ""));
      if (!retryable) return undefined;
      recovering = true;
      exhausted = undefined;
      const early = cutShort && !malformed;
      return {
        reason: malformed ? "Replace tool protocol with a readable answer"
          : early ? "Complete the answer after research stopped early"
          : "Complete a bounded answer after an interrupted request",
        final: true,
        followUp: early ? CUT_SHORT : INTERRUPTED,
      };
    },
    stream(model: Model<Api>, context: Context, options: SimpleStreamOptions = {}) {
      const current = phase(context);
      if (recovering && recoveryCalls >= 1) {
        exhausted = "The reserved completion request has been used";
        throw new Error(exhausted);
      }
      if (!recovering && requests.length >= limits.calls) {
        throw new Error(exhaust("The turn reached its model-call limit", "calls"));
      }
      // A round whose tools all failed is a different signal from one that answered with nothing
      // new: the model can still correct its arguments or change source, so it gets its own,
      // looser budget — and a message that says which of the two actually happened.
      if (!recovering && attempted) {
        if (progressed) { stalled = failed = 0; failing.clear(); }
        else if (succeeded) stalled += 1;
        else failed += 1;
        attempted = progressed = succeeded = false;
        if (stalled >= limits.stalledCalls || failed >= limits.failedCalls) {
          cutShort = true;
          const tools = [...failing].join(", ");
          // Calls the tools rejected are the model's inputs failing, not the sources behind them.
          throw new Error(stalled >= limits.stalledCalls
            ? exhaust("Research stopped after repeated tool rounds produced no new usable evidence", "stalled")
            : exhaust([...failing].every((name) => rejected.get(name))
              ? `Research stopped after repeated tool rounds failed: ${tools} rejected the input ${failing.size > 1 ? "they were" : "it was"} given`
              : `Research stopped after repeated tool rounds failed (${tools}); the data sources are unavailable`, "tool_failures"));
        }
      }
      const remaining = deadline - Date.now() - (recovering ? 0 : reserve);
      if (remaining <= 0) throw new Error(exhaust("The turn reached its execution deadline", "deadline"));
      if (recovering) recoveryCalls += 1;
      const trace: RequestTrace = { phase: current, startedAt: Date.now() };
      requests.push(trace);
      const out = createAssistantMessageEventStream();
      const controller = new AbortController();
      const requestMs = Math.min(limits.requestMs * (model.reasoning ? THINKING : 1), remaining);
      // Thinking counts against the output cap, so the short answer phases get the same headroom.
      const output = OUTPUT[current] * (model.reasoning && (current === "final" || current === "repair") ? THINKING : 1);
      const timeout = setTimeout(() => controller.abort(new Error("Model request deadline exceeded")), requestMs);
      timeout.unref?.();
      const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
      void (async () => {
        let last: AssistantMessage | undefined;
        let onAbort: (() => void) | undefined;
        try {
          const stream = streamModel(config, model, recovering ? { ...context, tools: [] } : context, {
            ...options, signal, timeoutMs: requestMs,
            maxTokens: Math.min(options.maxTokens ?? model.maxTokens, output),
            reasoning: model.reasoning && current === "recovery" ? "low" : options.reasoning,
            onResponse: async (response, selected) => { trace.status = response.status; await options.onResponse?.(response, selected); },
            ...(GLOBAL_FETCH_ONLY.has(model.api) ? {} : {
              fetch: async (...args: Parameters<typeof fetch>) => {
                try { return await (options.fetch ?? globalThis.fetch)(...args); }
                catch (err) { trace.error = failure(err); throw err; }
              },
            }),
          });
          const aborted = new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(new Error(controller.signal.aborted ? "Model request deadline exceeded" : exhausted ?? "Operation aborted"));
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
          });
          const iterator = stream[Symbol.asyncIterator]();
          while (true) {
            const next = await Promise.race([iterator.next(), aborted]);
            if (next.done) break;
            const event = next.value;
            if (event.type === "done" || event.type === "error") {
              last = event.type === "done" ? event.message : event.error;
              if (controller.signal.aborted || exhausted) {
                last.stopReason = "error";
                last.errorMessage = exhausted ?? "Model request deadline exceeded";
              }
              trace.endedAt = Date.now();
              trace.input = last.usage.input;
              trace.output = last.usage.output;
              if (last.stopReason === "error") trace.error ??= failure(last.errorMessage);
              last.execution = trace;
              out.push(last.stopReason === "error" ? { type: "error", reason: "error", error: last } : event);
            } else out.push(event);
          }
          out.end(last ?? await stream.result());
        } catch (err) {
          trace.error = failure(err);
          trace.endedAt = Date.now();
          const reason = options.signal?.aborted && !controller.signal.aborted && !exhausted ? "aborted" : "error";
          const failed: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
            timestamp: trace.startedAt, content: [], stopReason: reason, errorMessage: trace.error.message, execution: trace, usage: NO_USAGE };
          out.push({ type: "error", reason, error: failed });
          out.end(failed);
        } finally { clearTimeout(timeout); if (onAbort) signal.removeEventListener("abort", onAbort); }
      })();
      return out;
    },
  };
}
export type Execution = ReturnType<typeof execution>;
