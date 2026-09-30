import type { TurnStop } from "@/lib/agent/execution";
import { runTurn } from "@/lib/agent/turn";
import type { TurnInput, TurnResult } from "@/lib/agent/turn-types";

/**
 * What the runner adds around `runTurn`: the transient-retry allowance and a backstop for a hung
 * turn. A benchmark turn is bounded by the loop's own execution budget, its model calls and turn
 * deadline, exactly as a chat turn is.
 */

/** Maximum transient provider retries before recording an infrastructure error. */
export const EVAL_TRANSIENT_PROVIDER_RETRIES = 6;

/**
 * A turn still running this long has ignored the loop's own, shorter deadline; it is aborted so one
 * hung turn cannot block the rest of the run. Not a budget: a turn that works normally never sees it.
 */
export const EVAL_HUNG_TURN_MS = 20 * 60_000;

export function hungTurnError(): string {
  return `Agent turn was still running after ${EVAL_HUNG_TURN_MS / 60_000} minutes, past its own deadline, and was aborted`;
}

/**
 * True when a turn ended on its budget: the agent loop's model-call limit or its stop after
 * repeated stalled/failed tool rounds. A deadline, the loop's or the runner's hung-turn backstop,
 * is deliberately not a budget; it stays an agent_timeout.
 */
export function budgetExhausted(stop: TurnStop | undefined): boolean {
  return stop === "calls" || stop === "stalled" || stop === "tool_failures";
}

export async function runEvalTurn(input: TurnInput): Promise<TurnResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortLoop: ReturnType<typeof setInterval> | undefined;
  let activeAgent: Parameters<NonNullable<TurnInput["onAgent"]>>[0] | undefined;
  let stopped: { error: string; stop: TurnStop } | undefined;
  const abortController = new AbortController();
  const stopTurn = (error: string, stop: TurnStop): void => {
    if (stopped) return;
    stopped = { error, stop };
    abortController.abort();
    activeAgent?.abort();
    // A policy follow-up can start a fresh request after the first abort. Keep enforcing the
    // stop until runTurn returns instead of letting that queued request extend the task.
    abortLoop = setInterval(() => activeAgent?.abort(), 1_000);
  };
  try {
    timeout = setTimeout(() => stopTurn(hungTurnError(), "deadline"), EVAL_HUNG_TURN_MS);
    const result = await runTurn({
      ...input,
      evalAbortSignal: abortController.signal,
      onAgent: (agent) => {
        activeAgent = agent;
        if (stopped) agent.abort();
      },
    });
    return stopped ? { ...result, aborted: true, ...stopped } : result;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortLoop) clearInterval(abortLoop);
  }
}
