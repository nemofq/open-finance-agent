import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Context, Message } from "@earendil-works/pi-ai";
import { startsTurn } from "@/lib/agent/messages";
import type { EvidenceId, EvidenceLedger } from "@/lib/evidence/types";
import type { TimeContext } from "@/lib/time/types";
import { contextUsage } from "./budget";
import { type CheckpointInput, checkpointPrompt, validateCheckpoint } from "./checkpoint";
import { evidenceIndex, evidenceIndexBudget, serializeForSummary } from "./serialize";
import { stubBefore } from "./stubs";
import { estimateMessages, messageTokens, textTokens } from "./tokens";
import type { CompactionMessage, ContextBudget } from "./types";
import { mentionedIds } from "@/lib/evidence/ids";
import { blockText } from "@/lib/text/blocks";

/**
 * Layer 3: the chat's own model writes a research checkpoint, and code checks that
 * every figure in it is one the ledger holds. The transcript keeps everything; only what the
 * model sees is replaced (`applyCompaction`).
 */

/** Writes the checkpoint. The orchestrator passes a call to the chat's own model. */
export type Summarize = (context: { systemPrompt: string; messages: Message[] }) => Promise<string>;

/**
 * A `Summarize` over one streamed model call: a turn passes its budgeted stream, and `/compact`,
 * which runs outside a turn, a plain one. A failed call throws, so no empty checkpoint is written.
 */
export function summarizer(stream: (context: Context) => { result(): Promise<AssistantMessage> }): Summarize {
  return async (context) => {
    const reply = await stream(context).result();
    if (reply.stopReason === "error") throw new Error(reply.errorMessage ?? "checkpoint failed");
    return blockText(reply.content, "");
  };
}

export interface CompactSessionOptions {
  messages: AgentMessage[];
  ledger: EvidenceLedger;
  budget: ContextBudget;
  summarize: Summarize;
  /** A `/compact <focus>` instruction. */
  focus?: string;
  /** The turn's time context, so the checkpoint carries the date. */
  time?: TimeContext;
}

export interface CompactSessionResult {
  /** The full transcript with the checkpoint inserted at the cut point. */
  messages: AgentMessage[];
  compaction: CompactionMessage;
}


export async function compactSession(options: CompactSessionOptions): Promise<CompactSessionResult> {
  const { messages, ledger, budget, summarize, focus, time } = options;
  const start = lastCheckpointIndex(messages) + 1;
  const cut = findCut(messages, start, budget.keepRecent);

  const history = stubBefore(messages.slice(start, cut), cut - start, ledger);
  const input: CheckpointInput = {
    transcript: serializeForSummary(history),
    evidenceIndex: evidenceIndex(ledger, evidenceIndexBudget(budget.window)),
    focus,
    date: time?.localDate,
    previous: start > 0 ? checkpointAt(messages, start - 1) : undefined,
  };
  let result = validateCheckpoint(await write(summarize, input), ledger);
  if (result.stripped.length > 0) {
    // One retry, naming what was not backed: a checkpoint missing its numbers costs more than a call.
    const retry = validateCheckpoint(await write(summarize, { ...input, unsourced: result.stripped }), ledger);
    if (retry.stripped.length < result.stripped.length) result = retry;
  }
  const { summary, stripped } = result;

  const tokensBefore = contextUsage(messages, budget).used;
  const removed = estimateMessages(messages.slice(start, cut));
  const tokensAfter = Math.max(textTokens(summary), tokensBefore - removed + textTokens(summary));

  const compaction: CompactionMessage = {
    role: "compaction",
    summary,
    tokensBefore,
    tokensAfter,
    evidenceIds: citedIds(summary, ledger),
    timestamp: Date.now(),
    ...(focus ? { focus } : {}),
    ...(stripped.length > 0 ? { stripped } : {}),
  };

  return { messages: [...messages.slice(0, cut), compaction, ...messages.slice(cut)], compaction };
}

async function write(summarize: Summarize, input: CheckpointInput): Promise<string> {
  const { system, user } = checkpointPrompt(input);
  return summarize({
    systemPrompt: system,
    messages: [{ role: "user", content: [{ type: "text", text: user }], timestamp: Date.now() }],
  });
}

/** Ids the checkpoint cites that the ledger actually holds, so the UI can link them. */
function citedIds(summary: string, ledger: EvidenceLedger): EvidenceId[] {
  const cited = new Set(mentionedIds(summary));
  return [...cited].filter((id) => ledger.get(id) !== undefined);
}

function lastCheckpointIndex(messages: AgentMessage[]): number {
  return messages.findLastIndex((message) => message.role === "compaction");
}

function checkpointAt(messages: AgentMessage[], index: number): string | undefined {
  const message = messages[index];
  return message?.role === "compaction" ? message.summary : undefined;
}

/**
 * Where the checkpoint goes. The latest user turn (a running skill turn included) stays in full,
 * and earlier turns join it while they fit in `keepRecent`. When a single turn is already larger
 * than that, the cut falls inside it on an assistant message, so no tool result loses its call.
 */
export function findCut(messages: AgentMessage[], start: number, keepRecent: number): number {
  const turnStarts: number[] = [];
  const boundaries: number[] = [];
  for (let i = messages.length - 1; i > start; i -= 1) {
    if (startsTurn(messages[i])) turnStarts.push(i);
    if (startsTurn(messages[i]) || messages[i].role === "assistant") boundaries.push(i);
  }

  const candidates = turnStarts.length > 0 ? turnStarts : boundaries;
  // Only the message at `start` is left (a first turn whose reply was discarded): keep it whole
  // rather than summarising the question away; the caller sees an empty history.
  if (candidates.length === 0) return start;

  // The newest candidate is kept whatever it costs; earlier turns join it while they fit.
  let cut = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (tailTokens(messages, candidate) > keepRecent) break;
    cut = candidate;
  }
  return cut;
}

function tailTokens(messages: AgentMessage[], from: number): number {
  let total = 0;
  for (let i = from; i < messages.length; i += 1) total += messageTokens(messages[i]);
  return total;
}
