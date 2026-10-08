import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { applyCompaction } from "./apply";
import { extraTokens, isCustomMessage, messageTokens } from "./tokens";
import type { ContextBudget, ContextUsage } from "./types";

/**
 * Budgets derived from the model's window. There are no settings: a window, a
 * fraction and a floor are all the layers need.
 */

/** Assumed window when the provider reports none; the composer shows a badge asking for the real value. */
export const FALLBACK_WINDOW = 32_768;

/** A tool result view never falls below this, so a small window still shows a usable slice. */
const MIN_TOOL_RESULT_TOKENS = 2_000;

const TOOL_RESULT_SHARE = 0.05;
const STUB_SHARE = 0.5;
const COMPACT_SHARE = 0.75;
const KEEP_RECENT_SHARE = 0.25;

export function resolveContextBudget(model: Model<Api>): ContextBudget {
  const unknownWindow = !(model.contextWindow > 0);
  const window = unknownWindow ? FALLBACK_WINDOW : model.contextWindow;
  const quarter = Math.floor(window * KEEP_RECENT_SHARE);

  return {
    window,
    unknownWindow,
    toolResultMax: Math.max(MIN_TOOL_RESULT_TOKENS, Math.floor(window * TOOL_RESULT_SHARE)),
    stubAt: Math.floor(window * STUB_SHARE),
    compactAt: Math.floor(window * COMPACT_SHARE),
    keepRecent: quarter,
  };
}

/**
 * A message as pi's estimator may be handed it. pi knows only its own roles and would read an app
 * kind's missing `content`, so each app kind stands in as an empty user turn: it costs nothing there
 * (`contextUsage` counts it), and keeps its place and time, which tell pi which provider usage still
 * describes the context, as a compaction summary newer than an earlier reply's usage does.
 */
function forPiEstimate(message: AgentMessage): Message {
  if (!isCustomMessage(message)) return message as Message;
  return { role: "user", content: "", timestamp: message.timestamp };
}

/**
 * How full the model's context is. Provider usage is authoritative when the transcript carries
 * it; messages after it are estimated, including the custom kinds pi's estimator returns 0 for.
 */
export function contextUsage(messages: AgentMessage[], budget: ContextBudget): ContextUsage {
  const compactions = messages.filter((message) => message.role === "compaction").length;
  const visible = applyCompaction(messages);
  const estimate = estimateContextTokens(visible.map(forPiEstimate));
  const from = estimate.lastUsageIndex === null ? 0 : estimate.lastUsageIndex + 1;
  // An attached document sits beside a message's content rather than in it, so pi's estimator
  // misses it on a plain user message just as it misses the app's own message kinds entirely.
  const custom = visible
    .slice(from)
    .reduce((total, message) => total + (isCustomMessage(message) ? messageTokens(message) : extraTokens(message)), 0);

  return {
    used: estimate.tokens + custom,
    window: budget.window,
    unknownWindow: budget.unknownWindow,
    compactions,
  };
}
