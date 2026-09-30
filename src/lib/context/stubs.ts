import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { approxTokens } from "@/lib/attachments/digest";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";
import { evidenceOf } from "@/lib/evidence/ids";
import { evidenceTag } from "@/lib/evidence/tags";
import type { EvidenceEntry, EvidenceLedger } from "@/lib/evidence/types";
import { type SkillMessage, startsTurn } from "@/lib/agent/messages";
import { blockText } from "@/lib/text/blocks";
import { contextUsage } from "./budget";
import { textTokens, tokenChars } from "./tokens";
import type { ContextBudget } from "./types";

/**
 * Layer 2: in turns the agent has moved on from, a tool result is worth one line
 * that names its evidence id. The values are in the ledger, so nothing is lost; the current
 * turn and the saved transcript are untouched.
 */

/** Results with no ledger entry keep this much of their head: there is no id to fetch them back with. */
const UNTRACKED_TOKENS = 60;

export interface StubOptions {
  ledger: EvidenceLedger;
  budget: ContextBudget;
  /** Index of the first message of the current user turn; nothing from there on is stubbed. */
  currentTurnStart: number;
}

/**
 * Stub every eligible result at once, oldest first, once the context passes `budget.stubAt`.
 * Doing it in one batch keeps the prompt-cache prefix stable: a turn either sees the stubbed
 * prefix or it does not.
 */
export function stubOldResults(messages: AgentMessage[], options: StubOptions): AgentMessage[] {
  if (contextUsage(messages, options.budget).used <= options.budget.stubAt) return messages;
  const end = Math.max(0, Math.min(options.currentTurnStart, messages.length));
  return stubBefore(messages, end, options.ledger);
}

/** Replace results, report arguments and attached images before `end`. Input messages are never mutated. */
export function stubBefore(messages: AgentMessage[], end: number, ledger: EvidenceLedger): AgentMessage[] {
  if (end <= 0) return messages;
  const byCall = entriesByToolCall(messages, ledger);

  return messages.map((message, index) => {
    if (index >= end) return message;
    if (message.role === "toolResult") return stubResult(message, byCall);
    if (message.role === "assistant") return stubAssistant(message, byCall);
    if (message.role === "user") return stubUser(message);
    if (message.role === "skill") return stubSkill(message);
    return message;
  });
}

/**
 * An image is re-uploaded and re-charged on every single call for as long as it stays in the
 * context, whatever the conversation has moved on to, so it is dropped once the turn it belonged
 * to is behind us — the same trade tool results make. The note keeps the fact of it, and the file
 * is still on disk if the user brings it up again.
 */
function imageNote(attachment: string): string {
  return `(image from an earlier turn: ${attachment})`;
}

/**
 * A document costs the same on every call, and an inlined 8k-token memo costs a great deal more
 * than a picture. Once its turn is behind us the note stands in for it, and the model reads the
 * file again through `read_attachment` if the conversation comes back to it.
 */
function documentNote(document: StoredAttachment): string {
  const parts = `${document.parts.toLocaleString("en-US")} ${partNoun(document)}`;
  return `(attachment from an earlier turn: ${document.name}, ${parts}, ~${approxTokens(document.tokens)} tokens — use read_attachment)`;
}

function partNoun(document: StoredAttachment): string {
  const noun = document.kind === "pdf" ? "page" : document.kind === "table" ? "sheet" : "part";
  return document.parts === 1 ? noun : `${noun}s`;
}

function stubUser(message: UserMessage): UserMessage {
  if (!Array.isArray(message.content)) return message;
  let changed = false;
  const content = message.content.map((block) => {
    const attachment = (block as Partial<StoredImage>).attachment;
    if (block.type !== "image" || typeof attachment !== "string") return block;
    changed = true;
    return { type: "text", text: imageNote(attachment) } satisfies TextContent;
  });
  const documents = message.documents ?? [];
  if (documents.length === 0) return changed ? { ...message, content } : message;
  // Dropping `documents` is what stops `hydrateAttachments` inlining the file again.
  const stubbed: UserMessage = {
    ...message,
    content: [...content, ...documents.map((document): TextContent => ({ type: "text", text: documentNote(document) }))],
  };
  delete stubbed.documents;
  return stubbed;
}

/**
 * A skill turn's attachments are dropped and the notes go into the prompt instead of beside it.
 * The alternative — keeping `images` and marking them spent — would mean a second path in
 * `convertToLlm`, which builds an old skill turn and a new one exactly the same way; this way the
 * note reaches the model and the summarizer through the text both already read.
 */
function stubSkill(message: SkillMessage): SkillMessage {
  if (!message.images?.length && !message.documents?.length) return message;
  const notes = [
    ...(message.images ?? []).map((image) => imageNote(image.attachment)),
    ...(message.documents ?? []).map(documentNote),
  ].join("\n");
  const stubbed: SkillMessage = { ...message, prompt: `${message.prompt}\n\n${notes}` };
  delete stubbed.images;
  delete stubbed.documents;
  return stubbed;
}

/** Evidence entries per tool call: the ledger first, the persisted `details` as the fallback. */
function entriesByToolCall(messages: AgentMessage[], ledger: EvidenceLedger): Map<string, EvidenceEntry[]> {
  const byCall = new Map<string, EvidenceEntry[]>();
  const add = (entry: EvidenceEntry) => {
    if (!entry.toolCallId) return;
    const list = byCall.get(entry.toolCallId);
    if (list) list.push(entry);
    else byCall.set(entry.toolCallId, [entry]);
  };
  for (const entry of ledger.list()) add(entry);
  for (const message of messages) {
    if (message.role !== "toolResult" || byCall.has(message.toolCallId)) continue;
    for (const entry of evidenceOf(message.details)) add({ ...entry, toolCallId: message.toolCallId });
  }
  return byCall;
}

function stubResult(message: ToolResultMessage, byCall: Map<string, EvidenceEntry[]>): ToolResultMessage {
  const entries = byCall.get(message.toolCallId) ?? [];
  const text = entries.length > 0 ? evidenceStub(entries) : untrackedStub(message);
  if (text === undefined) return message;
  return { ...message, content: [{ type: "text", text }] };
}

function evidenceStub(entries: EvidenceEntry[]): string {
  const lines = entries.map((entry) => `${evidenceTag(entry)} ${entry.summary}${conflictNote(entry)}`);
  const ids = entries.map((entry) => entry.id).join(", ");
  return `${lines.join("\n")} (stubbed; evidence_get ${ids} for values)`;
}

/** Formats a note indicating conflicting evidence entries, if any. */
function conflictNote(entry: EvidenceEntry): string {
  const disagreeing = entry.conflicts?.filter((conflict) => !conflict.agree) ?? [];
  if (disagreeing.length === 0) return "";
  return ` (conflicts with ${[...new Set(disagreeing.map((conflict) => conflict.with))].join(", ")})`;
}

/**
 * A result the ledger never saw (a memory read, a skill load) cannot be fetched back, so it is
 * trimmed rather than replaced. Anything already short keeps its text.
 */
function untrackedStub(message: ToolResultMessage): string | undefined {
  const text = blockText(message.content, "\n");
  if (!text || textTokens(text) <= UNTRACKED_TOKENS) return undefined;
  return `${text.slice(0, tokenChars(UNTRACKED_TOKENS)).trimEnd()}\n(older result trimmed)`;
}

/** Old thinking goes; a report's arguments become its `R` id, which is what later turns cite. */
function stubAssistant(message: AssistantMessage, byCall: Map<string, EvidenceEntry[]>): AssistantMessage {
  let changed = false;
  const content = message.content.flatMap((block) => {
    if (block.type === "thinking") {
      changed = true;
      return [];
    }
    if (block.type === "toolCall" && byCall.get(block.id)?.some((entry) => entry.kind === "R")) {
      changed = true;
      return [{ ...block, arguments: { spec: reportStub(byCall.get(block.id)) } }];
    }
    return [block];
  });
  // An assistant message that was nothing but thinking still has to say something.
  if (!changed || content.length === 0) return message;
  return { ...message, content };
}

function reportStub(entries: EvidenceEntry[] | undefined): string {
  const report = entries?.find((entry) => entry.kind === "R");
  return report ? `<${report.id} stub>` : "<report stub>";
}

/** Index of the first message of the current user turn, for `currentTurnStart`. */
export function currentTurnStart(messages: AgentMessage[]): number {
  const start = messages.findLastIndex(startsTurn);
  return start < 0 ? messages.length : start;
}
