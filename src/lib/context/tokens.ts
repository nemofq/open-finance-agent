import { type AgentMessage, estimateTokens } from "@earendil-works/pi-agent-core";
import { toProviderShape } from "@/lib/agent/messages";
import { MAX_INLINE_TOKENS } from "@/lib/attachments/budget";
import type { StoredAttachment } from "@/lib/attachments/types";

/**
 * Token arithmetic for the context layers. Everything here uses pi's own
 * four-characters-to-a-token heuristic so our budgets and its estimates agree.
 */

const CHARS_PER_TOKEN = 4;

/**
 * What the documents on a message are worth. They sit beside the content rather than in it — pi
 * has no document block — so pi's estimator cannot see them either way.
 *
 * The estimate is the parse's own, capped at what hydration could possibly inline: a 2M-character
 * spreadsheet reaches the model as a schema digest, and charging the context for all of it would
 * compact a chat that was never anywhere near full.
 */
function documentTokens(documents: StoredAttachment[] | undefined): number {
  return (documents ?? []).reduce((total, document) => total + Math.min(document.tokens, MAX_INLINE_TOKENS), 0);
}

export function textTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** How many characters fit in a token budget. */
export function tokenChars(tokens: number): number {
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN));
}

/**
 * What a message costs on top of what pi's estimator can see. Only a plain user message needs it:
 * every other kind carrying documents is one pi does not estimate at all.
 */
export function extraTokens(message: AgentMessage): number {
  return message.role === "user" ? documentTokens(message.documents) : 0;
}

/** True for the app's own message kinds, which pi's estimator does not know about. */
export function isCustomMessage(message: AgentMessage): boolean {
  return message.role === "skill" || message.role === "scheduled" || message.role === "check" || message.role === "compaction";
}

/**
 * Tokens one message costs as the provider receives it (`toProviderShape`), so a check record or a
 * superseded draft the model never sees costs nothing. A checkpoint costs its summary, which
 * `applyCompaction` puts in place of the history before that conversion.
 */
export function messageTokens(message: AgentMessage): number {
  if (message.role === "compaction") return textTokens(message.summary);
  return toProviderShape([message]).reduce((total, sent) => total + estimateTokens(sent) + extraTokens(sent), 0);
}

/** Character heuristic over a whole list, for counts that provider usage would overstate. */
export function estimateMessages(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => total + messageTokens(message), 0);
}
