import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { StoredAttachment } from "@/lib/attachments/types";
import { evidenceTag } from "@/lib/evidence/tags";
import type { EvidenceEntry, EvidenceLedger } from "@/lib/evidence/types";
import { blockText } from "@/lib/text/blocks";
import { tokenChars } from "./tokens";

/**
 * What the summarizer reads: the stubbed transcript and the evidence index, never
 * raw payloads. pi's own `serializeConversation` is not used because it drops the app's custom
 * messages, and a `/skill` turn is exactly the user instruction a checkpoint must quote.
 */

/** Tool results are already stubbed by layer 2; this is the backstop for anything that is not. */
const RESULT_CHARS = 2_000;

/** A pasted document is clipped in the summarizer's input the way tool results are. */
const USER_CHARS = 4_000;

function clipUser(text: string): string {
  return text.length <= USER_CHARS ? text : `${text.slice(0, USER_CHARS)}\n[user text truncated at ${USER_CHARS} characters]`;
}

export function serializeForSummary(messages: AgentMessage[]): string {
  const parts: string[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "user": {
        const text = userText(message.content, IMAGE_NOTE);
        const lines = [...(text ? [clipUser(text)] : []), ...documentNotes(message.documents)];
        if (lines.length > 0) parts.push(`[User]: ${lines.join("\n")}`);
        break;
      }
      case "skill": {
        const images = (message.images ?? []).map(() => IMAGE_NOTE);
        parts.push(`[User /${message.skill}]: ${[clipUser(message.prompt), ...images, ...documentNotes(message.documents)].join("\n")}`);
        break;
      }
      case "assistant": {
        const text = blockText(message.content, "\n").trim();
        if (text) parts.push(`[Assistant]: ${text}`);
        const calls = message.content.flatMap((block) =>
          block.type === "toolCall" ? [`${block.name}(${args(block.arguments)})`] : [],
        );
        if (calls.length > 0) parts.push(`[Assistant tool calls]: ${calls.join("; ")}`);
        break;
      }
      case "toolResult": {
        const text = userText(message.content, "[image]");
        if (text) parts.push(`[Tool result ${message.toolName}]: ${clip(text, RESULT_CHARS)}`);
        break;
      }
      case "check":
        parts.push(`[Check ${message.check.rule} ${message.check.kind}]: ${message.check.reason}`);
        break;
      case "compaction":
        parts.push(`[Checkpoint]: ${message.summary}`);
        break;
    }
  }

  return parts.join("\n\n");
}

/**
 * A checkpoint stands in for the turns it replaces, so it has to record that a turn had a picture
 * in it: the summarizer never sees the image, but the model reading the checkpoint later needs to
 * know one existed before it decides a figure came out of nowhere.
 */
const IMAGE_NOTE = "[image attached]";

/**
 * A file is named rather than counted: a checkpoint that says a spreadsheet was attached is what
 * lets a later turn call `read_attachment` on it instead of concluding the figure came from
 * nowhere. The file itself is still on disk long after the text of it left the context.
 */
function documentNotes(documents: StoredAttachment[] | undefined): string[] {
  return (documents ?? []).map((document) => `[attached: ${document.name}]`);
}

function userText(content: string | (TextContent | ImageContent)[], imageNote: string): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => (block.type === "text" ? [block.text] : [imageNote]))
    .join("\n")
    .trim();
}

function args(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, item]) => `${key}=${clip(json(item), 200)}`)
    .join(", ");
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable]";
  }
}

function clip(text: string, chars: number): string {
  return text.length <= chars ? text : `${text.slice(0, chars)}…`;
}

/**
 * The ids the checkpoint may cite, newest first when they do not all fit. The index is the only
 * place figures come from, so it is never dropped entirely.
 */
export function evidenceIndex(ledger: EvidenceLedger, limitTokens: number): string {
  const entries = ledger.list();
  if (entries.length === 0) return "(no evidence recorded)";

  const chars = tokenChars(limitTokens);
  const lines: string[] = [];
  let used = 0;
  let kept = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const line = entryLine(entries[i]);
    if (used + line.length + 1 > chars && kept > 0) break;
    lines.unshift(line);
    used += line.length + 1;
    kept += 1;
  }

  const omitted = entries.length - kept;
  return omitted > 0 ? `…${omitted} earlier entries omitted (evidence_get)\n${lines.join("\n")}` : lines.join("\n");
}

function entryLine(entry: EvidenceEntry): string {
  const value = entry.value !== undefined && !entry.summary.includes(String(entry.value)) ? ` = ${entry.value}` : "";
  return `${evidenceTag(entry)} ${entry.summary}${value}`;
}

/** Tokens the index may take of a window: enough to cite from, never the whole budget. */
export function evidenceIndexBudget(window: number): number {
  return Math.max(500, Math.min(4_000, Math.floor(window * 0.15)));
}
