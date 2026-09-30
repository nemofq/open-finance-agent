/**
 * Retrying a model request that failed for a transient provider reason, such as a 503. The
 * benchmark opts into it through `TurnInput.transientProviderRetries`; a chat turn runs with a
 * budget of zero.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { isRetryableAssistantError, retryAssistantCall } from "@earendil-works/pi-ai/utils/retry";
import { NO_USAGE } from "./messages";

interface RetryablePromptAgent {
  state: { messages: AgentMessage[] };
  prompt(input: string | AgentMessage): Promise<void>;
  continue(): Promise<void>;
  waitForIdle(): Promise<void>;
}

export interface TransientPromptRetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  signal?: AbortSignal;
}

/** What pi's retry loop is handed for a run that did not end on a reply: settled, so never retried. */
const SETTLED: AssistantMessage = {
  role: "assistant", content: [], api: "openai-completions", provider: "", model: "", usage: NO_USAGE, stopReason: "stop", timestamp: 0,
};

/** Retry only the failed model continuation, preserving any completed tool results in context. */
export async function promptWithTransientRetries(
  agent: RetryablePromptAgent,
  prompt: string | AgentMessage,
  options: TransientPromptRetryOptions,
): Promise<{ retries: number; infrastructureError: boolean; errors: string[] }> {
  const errors: string[] = [];
  // pi retries only after a reply it classed as transient, so a second call follows a failed `last`.
  let last: AssistantMessage | undefined;
  const run = async (): Promise<AssistantMessage> => {
    if (last) {
      errors.push(last.errorMessage ?? "Transient provider error");
      // The failed assistant turn is safe to remove: the preceding user/tool result remains the
      // exact request context, so no successful tool operation is repeated.
      agent.state.messages = agent.state.messages.slice(0, -1);
      await agent.continue();
    } else {
      await agent.prompt(prompt);
    }
    await agent.waitForIdle();
    // The retry decision reads the message a retry drops. A run that ended on a tool result, such as
    // one whose truncated calls failed, has nothing to retry.
    const reply = agent.state.messages.at(-1);
    return reply?.role === "assistant" ? (last = reply) : SETTLED;
  };
  await retryAssistantCall(run, { enabled: true, maxRetries: options.maxRetries, baseDelayMs: options.baseDelayMs }, options.signal);

  const final = agent.state.messages.at(-1);
  const infrastructureError = !options.signal?.aborted && final?.role === "assistant" && isRetryableAssistantError(final);
  return { retries: errors.length, infrastructureError, errors };
}
