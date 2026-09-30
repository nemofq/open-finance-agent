/**
 * The message model: pi's messages, the fields this app adds to them, and the app's own roles.
 * Everything a transcript holds is one of these; the saved chat around them is `SessionFile` in
 * `src/lib/sessions/types.ts`.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message, SystemMessage, Usage } from "@earendil-works/pi-ai";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";
import type { CompactionMessage } from "@/lib/context/types";
import type { CheckMessage } from "@/lib/policy/types";
import { blockText } from "@/lib/text/blocks";
import type { RequestTrace } from "./execution";

declare module "@earendil-works/pi-ai" {
  interface AssistantMessage {
    /** The request that produced this message: its phase, timing, token counts and any error. */
    execution?: RequestTrace;
    /**
     * How long the model spent reasoning on this message, in milliseconds. The turn stamps it onto
     * pi's own message object (see `stampThinking`), so it reaches the transcript file and the wire.
     */
    thinkingMs?: number;
    /** A draft a correction replaced: kept in the transcript for the record, never sent to the model again. */
    superseded?: boolean;
  }
  interface UserMessage {
    /**
     * Documents attached to this turn, beside the content blocks rather than in them:
     * pi has no document block, and the text is hydrated from disk at the last step before the
     * provider. Images stay inside `content`, where pi's own image block already is.
     */
    documents?: StoredAttachment[];
  }
}

/** A `/skill` turn: what the user typed, kept apart from the expanded prompt the model receives. */
export interface SkillMessage {
  role: "skill";
  skill: string;
  /** Text typed next to the skill chip; may be empty. */
  request: string;
  /** The skill body wrapped around the request (see `applySkillInvocation`), as sent to the model. */
  prompt: string;
  /** Images attached to the skill turn; sent to the model after the expanded prompt. */
  images?: StoredImage[];
  /** Documents attached to the skill turn, as descriptors; the text is hydrated from disk. */
  documents?: StoredAttachment[];
  timestamp: number;
}

/** A durable prompt injected by the scheduled-task runner. It is rendered as an automatic turn. */
export interface ScheduledMessage {
  role: "scheduled";
  taskId: string;
  runId: string;
  /** The prompt as written in the task definition. */
  request: string;
  /** The expanded prompt sent to the model, including a skill body when selected. */
  prompt: string;
  skill?: string;
  timestamp: number;
}

declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    skill: SkillMessage;
    scheduled: ScheduledMessage;
    /** An enforcement decision; sent to the model only when it is a follow-up. */
    check: CheckMessage;
    /** A research checkpoint that stands in for everything before it. */
    compaction: CompactionMessage;
  }
}

/** Whether a message opens a turn: what the user typed, a skill run or a scheduled task. */
export function startsTurn(message: AgentMessage): boolean {
  return message.role === "user" || message.role === "skill" || message.role === "scheduled";
}

/** The documents a message carries beside its content; only a user or skill turn has any. */
export function messageDocuments(message: AgentMessage): StoredAttachment[] {
  return message.role === "user" || message.role === "skill" ? message.documents ?? [] : [];
}

/**
 * What the provider is sent for a transcript: pi's own messages, the app's turns as user messages,
 * and of the checks only an enforced follow-up still open. A superseded draft and an empty failed
 * reply are left out; a checkpoint is placed by `applyCompaction` before this runs.
 */
export function toProviderShape(messages: AgentMessage[]): Message[] {
  return messages.flatMap((m): Message[] => {
    if (m.role === "assistant" && m.superseded) return [];
    if (m.role === "assistant" && (m.stopReason === "error" || m.stopReason === "aborted") &&
      m.content.every((b) => b.type === "text" && !b.text.trim())) return [];
    if (m.role === "user" || m.role === "toolResult" || m.role === "assistant") return [m];
    if (m.role === "skill") return [{ role: "user", content: [{ type: "text", text: m.prompt }, ...(m.images ?? [])], ...(m.documents?.length ? { documents: m.documents } : {}), timestamp: m.timestamp }];
    if (m.role === "scheduled") return [{ role: "user", content: [{ type: "text", text: m.prompt }], timestamp: m.timestamp }];
    if (m.role === "check" && m.check.kind === "follow_up" && m.check.enforced && !m.check.resolved && m.check.text) return [{ role: "user", content: [{ type: "text", text: m.check.text }], timestamp: m.timestamp }];
    return [];
  });
}

/**
 * A transcript without pi's system messages. pi keeps the prompt and the tool declarations in the
 * transcript as system messages; the harness rebuilds both from settings for every request, so
 * they never reach a saved chat, the browser or the model's view of the chat.
 */
export function withoutSystemMessages<T extends AgentMessage>(messages: T[]): Exclude<T, SystemMessage>[] {
  return messages.filter((message): message is Exclude<T, SystemMessage> => message.role !== "system");
}

/**
 * A run's transcript split where the chat starts: pi's system messages at its head, and the chat
 * after them as a saved chat holds it. Code that places something by position in the chat works on
 * `chat` and puts `head` back in front, so pi still finds its prompt and tools at index 0.
 */
export function splitSystemHead(messages: AgentMessage[]): { head: AgentMessage[]; chat: AgentMessage[] } {
  const start = messages.findIndex((message) => message.role !== "system");
  const end = start < 0 ? messages.length : start;
  return { head: messages.slice(0, end), chat: messages.slice(end) };
}

/** The text of an assistant message, its text blocks one per line; empty for anything else. */
export function assistantText(message: AgentMessage | undefined): string {
  return message?.role === "assistant" ? blockText(message.content, "\n") : "";
}

/** The usage of a message no provider billed, such as a request that failed before it answered. */
export const NO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
