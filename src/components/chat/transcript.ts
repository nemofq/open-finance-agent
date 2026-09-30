import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { CompactionMessage } from "@/lib/context/types";
import type { EvidenceEntry } from "@/lib/evidence/types";
import { RULE_TITLES } from "@/lib/policy/summary";
import type { CheckRecord } from "@/lib/policy/types";
import { REPORT_TOOL } from "@/lib/reports/tool-name";
import { reportOf, type ReportRef } from "@/components/reports/report-call";
import { documentsOfMessage, imagesOfMessage, type MessageDocument, type MessageImage } from "./message-attachments";
import { type AnswerSummary, entriesIn, footerOf, partsOf } from "./evidence";

/** One rendered piece of an assistant turn, in the order it was streamed. */
export type MessagePart =
  | { kind: "text"; text: string }
  | {
      kind: "thinking";
      text: string;
      /** How long the model reasoned; absent on chats saved before the turn timed it. */
      durationMs?: number;
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: unknown;
      result?: string;
      isError?: boolean;
      /** The tool's structured payload beside its text result; shape is per-tool. */
      details?: unknown;
      /** When the call settled: the tool result's time. */
      timestamp?: number;
    };

/** A tool call; it carries every field `reportOf` reads, so it goes to the reports feature as is. */
type ToolPart = Extract<MessagePart, { kind: "tool" }>;

export type ChatItem =
  | {
      key: string;
      role: "user";
      text: string;
      skill?: string;
      scheduled?: boolean;
      /** Attached images, as thumbnails the bubble links to the full picture. */
      images?: MessageImage[];
      /** Attached documents, as chips that open the preview. */
      documents?: MessageDocument[];
    }
  | { key: string; role: "assistant"; parts: MessagePart[]; streaming?: boolean; entries?: EvidenceEntry[] }
  /** An answer the harness sent back to be revised, with the follow-up that sent it back. */
  | { key: string; role: "draft"; parts: MessagePart[]; check: CheckRecord; entries?: EvidenceEntry[] }
  /** One turn's enforcement decisions, as the answer footer under the turn that produced them. */
  | { key: string; role: "checks"; checks: CheckRecord[]; footer: AnswerSummary }
  | { key: string; role: "compaction"; compaction: CompactionMessage };

/** A tool outcome seen on the wire before its tool-result message arrived. */
export interface ToolOutcome {
  result: string;
  isError: boolean;
}

function textOf(content: { type: string; text?: string }[]): string {
  return content
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("\n")
    .trim();
}

function userText(message: Extract<AgentMessage, { role: "user" }>): string {
  return typeof message.content === "string" ? message.content : textOf(message.content);
}

/** The attachment fields of a user item, each left off entirely when the turn carried none. */
function attached(
  message: AgentMessage,
  sessionId: string | null,
  key: string,
): { images?: MessageImage[]; documents?: MessageDocument[] } {
  const images = imagesOfMessage(message, sessionId, key);
  const documents = documentsOfMessage(message, sessionId, key);
  return { ...(images.length === 0 ? {} : { images }), ...(documents.length === 0 ? {} : { documents }) };
}

/**
 * Answers the harness sent back for revision, by their index: an enforced follow-up is queued
 * right after the answer it judged, so that pair is one draft item rather than an answer the
 * reader has to work out was wrong. The check at `index + 1` is folded in, not shown as a footer.
 */
function draftsIn(messages: AgentMessage[]): Map<number, CheckRecord> {
  const drafts = new Map<number, CheckRecord>();
  messages.forEach((message, index) => {
    const next = messages[index + 1];
    if (message.role !== "assistant" || next?.role !== "check") return;
    if (next.check.kind === "follow_up" && next.check.enforced) drafts.set(index, next.check);
  });
  return drafts;
}

/**
 * Flatten a transcript into renderable items. Assistant content keeps its streamed
 * order (thinking, text and tool calls interleaved); tool results are folded back
 * into the tool call they belong to, from the transcript or the live `toolOutcomes`.
 *
 * `sessionId` is what turns a stored attachment's file name into the URL that serves it; a chat
 * that has not been saved yet has none, and only its optimistic previews can be shown.
 */
export function buildTranscript(
  saved: AgentMessage[],
  live: MessagePart[] = [],
  toolOutcomes: Record<string, ToolOutcome> = {},
  sessionId: string | null = null,
): ChatItem[] {
  // A check under a rule id this build does not know, such as a retired one, is skipped, so
  // retiring a rule never needs a reader for the records older chats hold.
  const messages = saved.filter((message) => message.role !== "check" || Object.hasOwn(RULE_TITLES, message.check.rule));
  const items: ChatItem[] = [];
  const toolParts = new Map<string, ToolPart>();
  const drafts = draftsIn(messages);
  let run: { key: string; checks: CheckRecord[] } | null = null;

  /**
   * Close the current run of check messages. Its footer counts every entry seen so far, which
   * is what the server's session-wide ledger holds at the moment the checks were recorded.
   */
  const flushChecks = (): void => {
    if (run === null) return;
    items.push({ key: run.key, role: "checks", checks: run.checks, footer: footerOf(items, run.checks) });
    run = null;
  };

  messages.forEach((message, index) => {
    if (message.role === "check") {
      // The follow-up that made the message before it a draft is shown on that draft instead.
      if (drafts.has(index - 1)) return;
      const started = run ?? { key: `c${index}`, checks: [] };
      started.checks.push(message.check);
      run = started;
      return;
    }

    flushChecks();

    if (message.role === "compaction") {
      items.push({ key: `k${index}`, role: "compaction", compaction: message });
      return;
    }

    if (message.role === "user") {
      items.push({
        key: `u${index}`,
        role: "user",
        text: userText(message),
        ...attached(message, sessionId, `u${index}`),
      });
      return;
    }

    if (message.role === "skill") {
      items.push({
        key: `u${index}`,
        role: "user",
        text: message.request,
        skill: message.skill,
        ...attached(message, sessionId, `u${index}`),
      });
      return;
    }

    if (message.role === "scheduled") {
      items.push({ key: `u${index}`, role: "user", text: message.request, scheduled: true, ...(message.skill ? { skill: message.skill } : {}) });
      return;
    }

    if (message.role === "assistant") {
      const parts: MessagePart[] = [];
      // The turn times the whole message's reasoning, so the total belongs to its first block.
      let thinkingMs = message.thinkingMs;
      for (const content of message.content) {
        if (content.type === "text" && content.text.trim()) {
          parts.push({ kind: "text", text: content.text });
        } else if (content.type === "thinking" && content.thinking.trim()) {
          parts.push({ kind: "thinking", text: content.thinking, ...(thinkingMs === undefined ? {} : { durationMs: thinkingMs }) });
          thinkingMs = undefined;
        } else if (content.type === "toolCall") {
          const part: ToolPart = {
            kind: "tool",
            id: content.id,
            name: content.name,
            args: content.arguments,
          };
          toolParts.set(content.id, part);
          parts.push(part);
        }
      }
      if (message.stopReason === "error" && message.errorMessage) {
        parts.push({ kind: "text", text: `> ⚠️ **Error:** ${message.errorMessage}` });
      }
      const check = drafts.get(index);
      // A cut-off draft carries only reasoning, but still displays its status.
      if (check) items.push({ key: `a${index}`, role: "draft", parts, check });
      else if (parts.length > 0) items.push({ key: `a${index}`, role: "assistant", parts });
      return;
    }

    if (message.role === "toolResult") {
      const part = toolParts.get(message.toolCallId);
      if (part) {
        part.result = textOf(message.content);
        part.isError = message.isError;
        part.timestamp = message.timestamp;
        if (message.details !== undefined) part.details = message.details;
      }
    }
  });

  flushChecks();

  for (const [id, outcome] of Object.entries(toolOutcomes)) {
    const part = toolParts.get(id);
    if (part && part.result === undefined) {
      part.result = outcome.result;
      part.isError = outcome.isError;
    }
  }

  if (live.length > 0) items.push({ key: "live", role: "assistant", parts: live, streaming: true });

  // References the model wrote in its prose resolve against the whole session's ledger, since a
  // turn can cite a figure whose tool result the transcript only carries further down.
  const entries = entriesIn(items);
  for (const item of items) {
    if (item.role === "assistant" || item.role === "draft") item.entries = entries;
  }
  return items;
}

/**
 * The turn's checks, as transcript messages after the answer. The server saves them in the same
 * place, but only once the event stream has closed, so a live turn appends its own copies from
 * the `check` events; ids already on the transcript are skipped so the two paths agree.
 */
export function appendChecks(messages: AgentMessage[], checks: CheckRecord[]): AgentMessage[] {
  const seen = new Set(messages.flatMap((message) => (message.role === "check" ? [message.check.id] : [])));
  const added: AgentMessage[] = checks
    .filter((check) => !seen.has(check.id))
    .map((check) => ({ role: "check", check, timestamp: check.timestamp }));
  return added.length === 0 ? messages : [...messages, ...added];
}

/**
 * The harness has revised the turn's final answer after it streamed: swap the text of the last
 * assistant message since the user's turn for `text`, leaving its reasoning and tool calls alone.
 * Nothing changes when the turn has no answer on screen yet (a re-attach mid-turn, say).
 */
export function reviseAnswer(messages: AgentMessage[], text: string): AgentMessage[] {
  const turnStart = messages.findLastIndex((message) => message.role === "user" || message.role === "skill");
  const index = messages.findLastIndex((message) => message.role === "assistant");
  const message = messages[index];
  if (index < turnStart || message?.role !== "assistant") return messages;
  let placed = false;
  type Block = (typeof message.content)[number];
  const content = message.content.flatMap((block): Block[] => {
    if (block.type !== "text") return [block];
    if (placed) return [];
    placed = true;
    return [{ ...block, text }];
  });
  if (!placed) content.push({ type: "text", text });
  return messages.with(index, { ...message, content });
}

/**
 * Reasoning has stopped on the live turn: give its thinking block the duration it took, so the
 * label settles before the server's `message_end` replaces the part with the saved copy.
 */
export function endThinking(parts: MessagePart[], durationMs: number): MessagePart[] {
  const index = parts.findLastIndex((part) => part.kind === "thinking");
  const part = parts[index];
  if (part?.kind !== "thinking" || part.durationMs !== undefined) return parts;
  return parts.with(index, { ...part, durationMs });
}

/**
 * What the collapsed reasoning row says: how long it took, once that is known; that it is still
 * running, while it grows; and only that it happened, on a chat saved before the turn timed it.
 */
export function thoughtLabel(durationMs: number | undefined, live = false): string {
  if (durationMs === undefined) return live ? "Thinking…" : "Thoughts";
  if (durationMs < 1000) return "Thought for a moment";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `Thought for ${seconds}s`;
  return `Thought for ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Append a streamed delta, extending the trailing part when it is of the same kind. */
export function appendDelta(parts: MessagePart[], kind: "text" | "thinking", delta: string): MessagePart[] {
  const last = parts.at(-1);
  if (last?.kind === kind) {
    return [...parts.slice(0, -1), { kind, text: last.text + delta }];
  }
  return [...parts, { kind, text: delta }];
}

/* ----------------------------------------------------------------- reports */

/** True for a tool part the chat renders as a report card rather than a raw tool call. */
export function isReportPart(part: MessagePart): boolean {
  return part.kind === "tool" && part.name === REPORT_TOOL;
}

/** The model's own content, whether the answer stood or was revised. */
/** Every report in the transcript, in the order the model produced them. */
export function reportsOf(items: ChatItem[]): ReportRef[] {
  const reports: ReportRef[] = [];
  for (const item of items) {
    for (const part of partsOf(item)) {
      const report = part.kind === "tool" ? reportOf(part) : null;
      if (report) reports.push({ ...report, ordinal: reports.length + 1 });
    }
  }
  return reports;
}
